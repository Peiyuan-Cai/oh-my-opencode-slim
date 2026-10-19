import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import type { Plugin } from '@opencode/plugin';

/** Custom V1 tools must not bypass the V2 host's resource-level boundaries. */
export async function guardLegacyTool(
  ctx: Plugin.Context,
  name: string,
  input: unknown,
  context: { sessionID: string; agent: string },
): Promise<void> {
  const assert = (action: string, resources: string[]) =>
    ctx.permission.assert({ ...context, action, resources });
  await assert(name, ['*']);
  if (name === 'subtask') await assert('subagent', ['orchestrator']);
  if (name !== 'ast_grep_search' && name !== 'ast_grep_replace') return;

  const args = input as { paths?: unknown; dryRun?: boolean };
  if (
    !Array.isArray(args.paths) ||
    !args.paths.length ||
    args.paths.some((p) => typeof p !== 'string')
  ) {
    throw new Error(
      'V2 AST tools require explicit file paths. Use the native glob tool first; directory recursion is not authorized.',
    );
  }
  const root = realpathSync(ctx.location.directory);
  const paths = [
    ...new Set(
      args.paths.map((path) =>
        realpathSync(
          isAbsolute(path) ? path : `${ctx.location.directory}/${path}`,
        ),
      ),
    ),
  ];
  for (const path of paths) {
    if (!statSync(path).isFile())
      throw new Error(
        'V2 AST tools accept files only. Use the native glob tool to select individual files.',
      );
    const rel = relative(root, path);
    if (
      rel === '..' ||
      rel.startsWith('../') ||
      rel.startsWith('..\\') ||
      isAbsolute(rel)
    ) {
      await assert('external_directory', [path]);
    }
  }
  await assert('read', paths);
  if (name === 'ast_grep_replace' && args.dryRun === false)
    await assert('edit', paths);
  // Only the authorized canonical files reach sg; it cannot expand directories.
  args.paths = paths;
}
