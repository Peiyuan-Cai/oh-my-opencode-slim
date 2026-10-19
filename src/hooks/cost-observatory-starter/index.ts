import fs from 'node:fs';
import path from 'node:path';
import type { PluginInput } from '@opencode-ai/plugin';
import { crossSpawn } from '../../utils/compat';
import { log } from '../../utils/logger';

const BB84_ROOT = process.env.BB84_AI_ROOT;
const PROJECT_ROOT = BB84_ROOT
  ? path.join(BB84_ROOT, 'tools', 'opencode_cost_observatory')
  : '';
const RUN_DIR = path.join(PROJECT_ROOT, '.run');
const BOOTSTRAP_PATH = path.join(PROJECT_ROOT, 'bootstrap.ps1');
const AUTOSTART_MARKER = path.join(RUN_DIR, 'autostart.requested');

export function createCostObservatoryStarterHook(_ctx: PluginInput) {
  let hasStarted = false;

  async function probeStatus() {
    const status = crossSpawn(
      [
        'pwsh',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        BOOTSTRAP_PATH,
        'status',
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const exitCode = await status.exited;
    const stdout = (await status.stdout()).trim();
    return exitCode === 0 ? stdout : 'stopped';
  }

  function hasFreshMarker() {
    if (!fs.existsSync(AUTOSTART_MARKER)) return false;
    try {
      const ageMs = Date.now() - fs.statSync(AUTOSTART_MARKER).mtimeMs;
      return ageMs < 60_000;
    } catch {
      return false;
    }
  }

  async function maybeStart() {
    if (!BB84_ROOT) return;
    if (hasStarted) return;

    if (!fs.existsSync(BOOTSTRAP_PATH)) {
      log('[cost-observatory-starter] bootstrap script missing', {
        path: BOOTSTRAP_PATH,
      });
      return;
    }

    if (hasFreshMarker()) {
      log(
        '[cost-observatory-starter] wrapper startup already requested recently',
      );
      return;
    }

    try {
      const stdout = await probeStatus();
      if (stdout && stdout !== 'stopped') {
        hasStarted = true;
        log('[cost-observatory-starter] backend already running', {
          pid: stdout,
        });
        return;
      }
    } catch (error) {
      log('[cost-observatory-starter] status probe failed', error);
    }

    try {
      crossSpawn(
        [
          'pwsh',
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-File',
          BOOTSTRAP_PATH,
          'start',
        ],
        {
          stdout: 'ignore',
          stderr: 'ignore',
        },
      );
      log('[cost-observatory-starter] backend start requested');
    } catch (error) {
      log('[cost-observatory-starter] backend start request failed', error);
      return;
    }

    setTimeout(async () => {
      try {
        const stdout = await probeStatus();
        if (stdout && stdout !== 'stopped') {
          hasStarted = true;
          log('[cost-observatory-starter] backend confirmed running', {
            pid: stdout,
          });
        }
      } catch (error) {
        log('[cost-observatory-starter] delayed status probe failed', error);
      }
    }, 1000);
  }

  return {
    maybeStart,
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== 'session.created') return;
      const props = event.properties as
        | { info?: { parentID?: string } }
        | undefined;
      if (props?.info?.parentID) return;
      setTimeout(() => {
        void maybeStart();
      }, 0);
    },
  };
}
