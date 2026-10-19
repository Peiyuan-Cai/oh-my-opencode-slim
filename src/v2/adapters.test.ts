import { describe, expect, test } from 'bun:test';
import { Mcp } from '@opencode/plugin';
import { Schema } from 'effect';
import { context7 } from '../mcp/context7';
import {
  adaptMcp,
  adaptPermissions,
  adaptPrompt,
  applyAgent,
  parseModel,
  toLegacyTranscript,
} from './adapters';
import { adaptEvent } from './events';

describe('OMO1 V2 platform translation', () => {
  test('MCP adaptation omits explicit undefined fields rejected by the real V2 schema', () => {
    const entry = { ...context7, headers: undefined };
    expect(() => Schema.decodeUnknownSync(Mcp.ServerConfig)(entry)).toThrow();
    const converted = adaptMcp(entry);
    expect(converted).not.toHaveProperty('headers');
    expect(() =>
      Schema.decodeUnknownSync(Mcp.ServerConfig)(converted),
    ).not.toThrow();
    expect(
      adaptMcp({
        type: 'local',
        command: ['fixture'],
        environment: undefined,
        enabled: false,
        timeout: 1000,
      }),
    ).toEqual({
      type: 'local',
      command: ['fixture'],
      disabled: true,
      timeout: { catalog: 1000, execution: 1000 },
    });
  });
  test('preserves model identity and reasoning variant', () => {
    expect(parseModel('vendor/reasoner#high')).toEqual({
      providerID: 'vendor',
      id: 'reasoner',
      variant: 'high',
    });
    expect(parseModel('vendor/reasoner', 'max')).toEqual({
      providerID: 'vendor',
      id: 'reasoner',
      variant: 'max',
    });
    expect(() => parseModel('broken')).toThrow();
  });
  test('maps write and delegation restrictions without widening them', () => {
    expect(
      adaptPermissions({
        bash: 'deny',
        task: { '*': 'deny', explorer: 'allow' },
        edit: 'deny',
      }),
    ).toEqual([
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'subagent', resource: '*', effect: 'deny' },
      { action: 'subagent', resource: 'explorer', effect: 'allow' },
      { action: 'edit', resource: '*', effect: 'deny' },
    ]);
  });
  test('host default allow cannot undo OMO1 read-only roles; host denies win', () => {
    const target = {
      permissions: [
        { action: '*', resource: '*', effect: 'allow' },
        { action: 'shell', resource: '*', effect: 'deny' },
      ],
    };
    applyAgent(target, {
      model: 'p/m',
      permission: { edit: 'deny', bash: 'allow' },
    });
    expect(target.permissions.at(-1)?.effect).toBe('deny');
    expect(target.permissions.find((r) => r.action === 'edit')?.effect).toBe(
      'deny',
    );
  });
  test('changes tool vocabulary, never specialist roles', () => {
    expect(
      adaptPrompt(
        'Use `task` with subagent_type="oracle" and task_id; use `bash`.',
      ),
    ).toBe('Use `subagent` with agent="oracle" and sessionID; use `shell`.');
  });
  test('transcript reads actual V2 assistant content, not an empty parts array', () => {
    expect(
      toLegacyTranscript(
        [
          {
            type: 'assistant',
            id: 'm',
            content: [{ type: 'text', text: 'result' }],
          },
        ],
        's',
        'oracle',
      )[0].parts,
    ).toEqual([{ type: 'text', text: 'result' }]);
  });
  test('failure and user cancellation never synthesize successful idle', () => {
    expect(
      adaptEvent({
        type: 'session.execution.interrupted',
        data: { sessionID: 's' },
      })[0],
    ).toEqual({
      type: 'session.error',
      properties: { sessionID: 's', error: { name: 'AbortError' } },
    });
    expect(
      adaptEvent({
        type: 'session.execution.failed',
        data: { sessionID: 's' },
      }).some((e) => e.type === 'session.idle'),
    ).toBe(false);
    expect(
      adaptEvent({
        type: 'session.execution.succeeded',
        data: { sessionID: 's' },
      })[0].type,
    ).toBe('session.idle');
  });
});
