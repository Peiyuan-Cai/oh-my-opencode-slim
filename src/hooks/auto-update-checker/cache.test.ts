import { describe, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from './constants';

// Mock logger to avoid noise
mock.module('../../utils/logger', () => ({
  log: mock(() => {}),
}));

mock.module('../../cli/config-manager', () => ({
  stripJsonComments: (s: string) => s,
  getOpenCodeConfigPaths: () => [
    '/mock/config/opencode.json',
    '/mock/config/opencode.jsonc',
  ],
}));

// Cache buster for dynamic imports
let importCounter = 0;
const packageInstallDir = path.join(
  '/home',
  'user',
  '.cache',
  'opencode',
  'packages',
  'oh-my-opencode-slim@latest',
);
const packageJsonPath = path.join(packageInstallDir, 'package.json');
const runtimePackageJsonPath = path.join(
  packageInstallDir,
  'node_modules',
  'oh-my-opencode-slim',
  'package.json',
);
const installedPackagePath = path.join(
  packageInstallDir,
  'node_modules',
  'oh-my-opencode-slim',
);

describe('auto-update-checker/cache', () => {
  describe('resolveInstallContext', () => {
    test('detects OpenCode packages install root from runtime package path', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: string) => p === packageJsonPath,
      );
      try {
        const { resolveInstallContext } = await import(
          `./cache?test=${importCounter++}`
        );
        const context = resolveInstallContext(runtimePackageJsonPath);

        expect(context).toEqual({
          installDir: packageInstallDir,
          packageJsonPath,
        });
      } finally {
        existsSpy.mockRestore();
      }
    });

    test('does not fall back to legacy cache when runtime path is active but wrapper root is invalid', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(() => false);
      try {
        const { resolveInstallContext } = await import(
          `./cache?test=${importCounter++}`
        );
        expect(resolveInstallContext(runtimePackageJsonPath)).toBeNull();
      } finally {
        existsSpy.mockRestore();
      }
    });
  });

  describe('preparePackageUpdate', () => {
    test('returns null when no install context is available', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
      try {
        const { preparePackageUpdate } = await import(
          `./cache?test=${importCounter++}`
        );
        expect(preparePackageUpdate('1.0.1')).toBeNull();
      } finally {
        existsSpy.mockRestore();
      }
    });

    test('updates packages wrapper dependency and removes installed package', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: string) => p === packageJsonPath || p === installedPackagePath,
      );
      const readSpy = spyOn(fs, 'readFileSync').mockImplementation(
        (p: string) => {
          if (p === packageJsonPath) {
            return JSON.stringify({
              dependencies: {
                'oh-my-opencode-slim': '0.9.1',
              },
            });
          }
          return '';
        },
      );
      const writtenData: string[] = [];
      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(
        (_path: string, data: string) => {
          writtenData.push(data);
        },
      );
      const rmSyncSpy = spyOn(fs, 'rmSync').mockReturnValue(undefined);
      try {
        const { preparePackageUpdate } = await import(
          `./cache?test=${importCounter++}`
        );
        const result = preparePackageUpdate(
          '0.9.11',
          'oh-my-opencode-slim',
          runtimePackageJsonPath,
        );

        expect(result).toBe(packageInstallDir);
        expect(rmSyncSpy).toHaveBeenCalledWith(installedPackagePath, {
          recursive: true,
          force: true,
        });
        expect(writtenData.length).toBeGreaterThan(0);
        expect(JSON.parse(writtenData[0])).toEqual({
          dependencies: {
            'oh-my-opencode-slim': '0.9.11',
          },
        });
      } finally {
        existsSpy.mockRestore();
        readSpy.mockRestore();
        writeSpy.mockRestore();
        rmSyncSpy.mockRestore();
      }
    });

    test('keeps working when dependency is already on target version', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: string) =>
          p === path.join(CACHE_DIR, 'package.json') ||
          p === path.join(CACHE_DIR, 'node_modules', 'oh-my-opencode-slim'),
      );
      const readSpy = spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          dependencies: {
            'oh-my-opencode-slim': '1.0.1',
          },
        }),
      );
      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const rmSyncSpy = spyOn(fs, 'rmSync').mockReturnValue(undefined);
      try {
        const { preparePackageUpdate } = await import(
          `./cache?test=${importCounter++}`
        );
        const result = preparePackageUpdate(
          '1.0.1',
          'oh-my-opencode-slim',
          null,
        );

        expect(result).toBe(CACHE_DIR);
        expect(writeSpy).not.toHaveBeenCalled();
        expect(rmSyncSpy).toHaveBeenCalled();
      } finally {
        existsSpy.mockRestore();
        readSpy.mockRestore();
        writeSpy.mockRestore();
        rmSyncSpy.mockRestore();
      }
    });
  });
});
