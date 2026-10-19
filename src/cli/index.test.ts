/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../..');

function runCli(args: string[]) {
  const xdgConfigHome = mkdtempSync(join(tmpdir(), 'omoo-cli-test-'));

  try {
    return Bun.spawnSync([process.execPath, 'src/cli/index.ts', ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: xdgConfigHome,
        OPENCODE_CONFIG_DIR: join(xdgConfigHome, 'opencode'),
        OPENCODE_TUI_CONFIG: join(xdgConfigHome, 'opencode', 'tui.json'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } finally {
    rmSync(xdgConfigHome, { recursive: true, force: true });
  }
}

describe('cli index', () => {
  test('passes --preset to install dry-run config generation', () => {
    const result = runCli([
      'install',
      '--dry-run',
      '--skills=no',
      '--no-tui',
      '--preset=opencode-go',
    ]);

    expect(result.exitCode).toBe(0);

    const stdout = result.stdout.toString();
    expect(stdout).toContain('"preset": "opencode-go"');
    expect(stdout).toContain(
      'Generated OpenAI and OpenCode Go presets; opencode-go is active.',
    );
  });

  test('shows --preset in help text', () => {
    const result = runCli(['install', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('--preset=<name>');
  });
});
