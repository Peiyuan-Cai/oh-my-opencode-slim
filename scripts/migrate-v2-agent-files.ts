import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { migrateAgentFile } from '../src/v2/agent-files';

const argument = process.argv[2];
if (!argument || argument.startsWith('--')) {
  throw new Error(
    'Usage: bun scripts/migrate-v2-agent-files.ts <config-directory> [--apply]. Default: dry run.',
  );
}
const configDir = resolve(argument);
const agentsDir = join(configDir, 'agents');
function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? walk(path)
      : entry.isFile() && entry.name.endsWith('.md')
        ? [path]
        : [];
  });
}
// Read and validate every referenced file before writing anything.
const changes = walk(agentsDir).flatMap((file) => {
  const before = readFileSync(file, 'utf8');
  const after = migrateAgentFile(file, before);
  return before === after ? [] : [{ file, before, after }];
});
if (!process.argv.includes('--apply')) {
  console.log(
    JSON.stringify(
      { mode: 'dry-run', files: changes.map((c) => c.file) },
      null,
      2,
    ),
  );
} else if (!changes.length) {
  console.log('No agent-file migration required.');
} else {
  for (const change of changes) {
    if (readFileSync(change.file, 'utf8') !== change.before)
      throw new Error(`File changed during migration: ${change.file}`);
  }
  const backup = join(configDir, 'migration-backups', `omo1-v2-${Date.now()}`);
  for (const change of changes) {
    const target = join(backup, relative(configDir, change.file));
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(change.file, target);
  }
  // Backups are outside agents/ so the host cannot discover duplicate agents.
  for (const change of changes) writeFileSync(change.file, change.after);
  console.log(
    JSON.stringify(
      { mode: 'applied', backup, files: changes.map((c) => c.file) },
      null,
      2,
    ),
  );
}
