import { afterEach, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { guardLegacyTool } from './tool-permissions';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(deny: (action: string, paths: string[]) => boolean) {
  const root = mkdtempSync(join(tmpdir(), 'omo-v2-permissions-'));
  roots.push(root);
  const calls: Array<{ action: string; resources: string[] }> = [];
  const ctx = {
    location: { directory: root },
    permission: {
      assert: async (r: { action: string; resources: string[] }) => {
        calls.push(r);
        if (deny(r.action, r.resources)) throw new Error('Permission denied');
      },
    },
  } as unknown as Plugin.Context;
  return { root, ctx, calls };
}
const scope = { sessionID: 's', agent: 'oracle' };

test('leaf subtask denial prevents any child creation', async () => {
  const f = fixture((action) => action === 'subagent');
  let children = 0;
  const execute = async () => {
    await guardLegacyTool(f.ctx, 'subtask', {}, scope);
    children++;
  };
  await expect(execute()).rejects.toThrow('Permission denied');
  expect(children).toBe(0);
  expect(f.calls.at(-1)).toMatchObject({
    action: 'subagent',
    resources: ['orchestrator'],
  });
});

test('file-specific edit denial leaves the targeted file untouched', async () => {
  const f = fixture(
    (action, paths) =>
      action === 'edit' && paths.includes(join(f.root, 'locked.ts')),
  );
  const target = join(f.root, 'locked.ts');
  writeFileSync(target, 'original');
  const execute = async () => {
    await guardLegacyTool(
      f.ctx,
      'ast_grep_replace',
      { paths: ['locked.ts'], dryRun: false },
      scope,
    );
    writeFileSync(target, 'changed');
  };
  await expect(execute()).rejects.toThrow('Permission denied');
  expect(readFileSync(target, 'utf8')).toBe('original');
});

test('AST search honors actual read resources and refuses directories before execution', async () => {
  const f = fixture((action) => action === 'read');
  const file = join(f.root, 'secret.ts');
  writeFileSync(file, 'secret');
  await expect(
    guardLegacyTool(f.ctx, 'ast_grep_search', { paths: [file] }, scope),
  ).rejects.toThrow('Permission denied');
  expect(f.calls.at(-1)).toMatchObject({ action: 'read', resources: [file] });
  await expect(
    guardLegacyTool(f.ctx, 'ast_grep_search', { paths: [f.root] }, scope),
  ).rejects.toThrow('files only');
  await expect(
    guardLegacyTool(f.ctx, 'ast_grep_search', {}, scope),
  ).rejects.toThrow('explicit file');
});

test('symlink targets are canonicalized and external directories checked before reads', async () => {
  const f = fixture((action) => action === 'external_directory');
  const external = mkdtempSync(join(tmpdir(), 'omo-v2-outside-'));
  roots.push(external);
  const file = join(external, 'file.ts');
  writeFileSync(file, 'content');
  symlinkSync(file, join(f.root, 'linked.ts'));
  await expect(
    guardLegacyTool(f.ctx, 'ast_grep_search', { paths: ['linked.ts'] }, scope),
  ).rejects.toThrow('Permission denied');
  expect(f.calls.at(-1)).toMatchObject({
    action: 'external_directory',
    resources: [file],
  });
  expect(f.calls.some((c) => c.action === 'read')).toBe(false);
});

test('authorized exact files can be edited without expanding siblings', async () => {
  const f = fixture(() => false);
  const target = join(f.root, 'allowed.ts');
  writeFileSync(target, 'old');
  mkdirSync(join(f.root, 'other'));
  writeFileSync(join(f.root, 'other/locked.ts'), 'untouched');
  const args = { paths: ['allowed.ts'], dryRun: false };
  await guardLegacyTool(f.ctx, 'ast_grep_replace', args, scope);
  expect(args.paths).toEqual([target]);
  expect(f.calls.at(-1)).toMatchObject({ action: 'edit', resources: [target] });
});
