import { describe, expect, test } from 'bun:test';
import { getRestrictedMcpDenies } from './agent-mcp-blacklist';

describe('getRestrictedMcpDenies', () => {
  test('orchestrator gets no denies (operator for all 3)', () => {
    expect(getRestrictedMcpDenies('orchestrator')).toEqual([]);
  });

  test('orchestrator-beta inherits orchestrator (operator)', () => {
    expect(getRestrictedMcpDenies('orchestrator-beta')).toEqual([]);
  });

  test('orchestrator-delta inherits orchestrator (operator)', () => {
    expect(getRestrictedMcpDenies('orchestrator-delta')).toEqual([]);
  });

  test('fixer gets no denies (operator)', () => {
    expect(getRestrictedMcpDenies('fixer')).toEqual([]);
  });

  test('fixer-alpha inherits fixer (operator)', () => {
    expect(getRestrictedMcpDenies('fixer-alpha')).toEqual([]);
  });

  test('designer-delta inherits designer (operator)', () => {
    expect(getRestrictedMcpDenies('designer-delta')).toEqual([]);
  });

  test('laborer is operator (no denies)', () => {
    expect(getRestrictedMcpDenies('laborer')).toEqual([]);
  });

  test('librarian gets windows-mcp deny only', () => {
    expect(getRestrictedMcpDenies('librarian')).toEqual(['windows-mcp']);
  });

  test('librarian-alpha inherits librarian (windows-mcp deny only)', () => {
    expect(getRestrictedMcpDenies('librarian-alpha')).toEqual(['windows-mcp']);
  });

  test('oracle gets all 3 restricted MCPs denied', () => {
    expect(getRestrictedMcpDenies('oracle').sort()).toEqual(
      ['chrome-devtools', 'playwright', 'windows-mcp'].sort(),
    );
  });

  test('oracle-beta inherits oracle (all 3 denied)', () => {
    expect(getRestrictedMcpDenies('oracle-beta').sort()).toEqual(
      ['chrome-devtools', 'playwright', 'windows-mcp'].sort(),
    );
  });

  test('explorer gets all 3 denied', () => {
    expect(getRestrictedMcpDenies('explorer').sort()).toEqual(
      ['chrome-devtools', 'playwright', 'windows-mcp'].sort(),
    );
  });

  test('gist gets all 3 denied', () => {
    expect(getRestrictedMcpDenies('gist').sort()).toEqual(
      ['chrome-devtools', 'playwright', 'windows-mcp'].sort(),
    );
  });

  test('unknown agent name defaults to safe (all 3 denied)', () => {
    expect(getRestrictedMcpDenies('foo-unknown').sort()).toEqual(
      ['chrome-devtools', 'playwright', 'windows-mcp'].sort(),
    );
  });
});
