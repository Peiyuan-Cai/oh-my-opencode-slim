import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateAgentFile } from './agent-files';

test('expands base prompt into native body, preserves variant contract, and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omo-agent-v2-'));
  try {
    writeFileSync(join(dir, 'base.md'), 'Base method: review correctness.\n');
    const file = join(dir, 'oracle-alpha.md');
    const before =
      '---\ndescription: Review\nmode: subagent\nhidden: true\nprompt: "{file:base.md}"\npermission:\n  edit: deny\n---\n\nVariant ALPHA contract.\n';
    const after = migrateAgentFile(file, before);
    expect(after).toContain('hidden: false');
    expect(after).not.toContain('prompt:');
    expect(after).toContain('permission:\n  edit: deny');
    expect(after).toContain(
      'Base method: review correctness.\n\nVariant ALPHA contract.',
    );
    expect(migrateAgentFile(file, after)).toBe(after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps unrelated internal hidden agents and CRLF line endings', () => {
  const before =
    '---\r\nmode: subagent\r\nhidden: true\r\n---\r\nInternal advisor.\r\n';
  expect(migrateAgentFile('/project/councillor.md', before)).toBe(before);
});

test('missing referenced prompt fails without rewriting the source', () => {
  expect(() =>
    migrateAgentFile(
      '/nonexistent/agents/fixer-alpha.md',
      '---\nprompt: "{file:missing.md}"\n---\nVariant.\n',
    ),
  ).toThrow();
});
