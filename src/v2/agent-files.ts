import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

/** Migrate only V1 fields whose effective V2 behavior differs for this setup.
 * Permission/model frontmatter is left to the host's compatibility reader.
 */
export function migrateAgentFile(file: string, source: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return source;
  let header = match[1];
  let body = match[2];
  let changed = false;
  const prompt = header.match(/^prompt:\s*(.+)$/m);
  if (prompt) {
    const value = prompt[1].trim().replace(/^["']|["']$/g, '');
    const reference = value.match(/^\{file:(.+)\}$/);
    // Do not silently reinterpret YAML block scalars or arbitrary templates.
    if (reference) {
      const path = reference[1].startsWith('~/')
        ? resolve(homedir(), reference[1].slice(2))
        : resolve(dirname(file), reference[1]);
      const base = readFileSync(path, 'utf8').trim();
      if (!body.includes(base)) body = `${base}\n\n${body.trimStart()}`;
      header = header.replace(/^prompt:[^\n]*\n?/m, '');
      changed = true;
    }
  }
  if (
    /(?:fixer|oracle|designer|explorer|librarian)-(?:alpha|beta|gamma|delta)\.md$/.test(
      file,
    )
  ) {
    const next = header.replace(/^hidden:[ \t]*true[ \t]*$/m, 'hidden: false');
    changed ||= next !== header;
    header = next;
  }
  if (!changed) return source;
  return `---\n${header.trimEnd()}\n---\n${body}`.replace(/\n/g, newline);
}
