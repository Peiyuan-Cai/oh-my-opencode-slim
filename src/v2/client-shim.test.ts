import { describe, expect, mock, test } from 'bun:test';
import type { Plugin } from '@opencode/plugin';
import { createClientShim } from './client-shim';

function fixture() {
  const values = new Map();
  const session = {
    get: mock(async () => ({
      id: 's',
      agent: 'orchestrator-delta',
      model: { providerID: 'manual', id: 'override', variant: 'xhigh' },
    })),
    create: mock(async () => ({ id: 'child' })),
    prompt: mock(async () => ({})),
    wait: mock(async () => {}),
    switchAgent: mock(async () => {}),
    switchModel: mock(async () => {}),
    update: mock(async () => {}),
    context: mock(async () => [
      { type: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]),
  };
  const ctx = {
    session,
    location: { directory: '/project' },
    storage: {
      get: async (k: string) => values.get(k),
      set: async (k: string, v: unknown) => {
        values.set(k, v);
      },
      remove: async (k: string) => {
        values.delete(k);
      },
    },
  } as unknown as Plugin.Context;
  return { session, shim: createClientShim(ctx), ctx };
}

describe('V2 session semantics', () => {
  test('auto-continue retains BOTH current root agent and manual model by never switching either', async () => {
    const { session, shim } = fixture();
    await shim.client.session.prompt({
      path: { id: 's' },
      body: {
        agent: 'orchestrator-beta',
        model: { providerID: 'stale', modelID: 'preset-default' },
        parts: [{ type: 'text', text: '[Auto-continue: enabled] Continue.' }],
      },
    });
    expect(session.switchAgent).not.toHaveBeenCalled();
    expect(session.switchModel).not.toHaveBeenCalled();
    expect(session.prompt.mock.calls[0][0]).not.toHaveProperty('agent');
    expect(session.prompt.mock.calls[0][0]).not.toHaveProperty('model');
    expect(session.wait).toHaveBeenCalled();
  });
  test('countdown notification queues without starting the model', async () => {
    const { session, shim } = fixture();
    await shim.client.session.prompt({
      path: { id: 's' },
      body: {
        noReply: true,
        parts: [{ type: 'text', text: 'Auto-continue: countdown' }],
      },
    });
    expect(session.prompt.mock.calls[0][0]).toMatchObject({
      delivery: 'queue',
      resume: false,
    });
    expect(session.wait).not.toHaveBeenCalled();
  });
  test('only new plugin-owned children may receive initial agent/model overrides', async () => {
    const { session, shim } = fixture();
    await shim.client.session.create({ body: { parentID: 's' } });
    await shim.client.session.prompt({
      path: { id: 'child' },
      body: {
        agent: 'councillor',
        model: { providerID: 'p', modelID: 'm' },
        variant: 'high',
        parts: [{ type: 'text', text: 'Review' }],
      },
    });
    expect(session.switchAgent.mock.calls[0][0]).toEqual({
      sessionID: 'child',
      agent: 'councillor',
    });
    expect(session.switchModel.mock.calls[0][0]).toEqual({
      sessionID: 'child',
      model: { providerID: 'p', id: 'm', variant: 'high' },
    });
    await expect(
      shim.client.session.prompt({
        path: { id: 'child' },
        body: {
          agent: 'build',
          parts: [{ type: 'text', text: 'unsafe override' }],
        },
      }),
    ).rejects.toThrow('cannot safely override');
  });
  test('todo lists persist in plugin storage and are isolated per session', async () => {
    const { shim, ctx } = fixture();
    await shim.todos.write('s', [
      { id: '1', content: 'work', status: 'pending', priority: 'high' },
    ]);
    expect(await createClientShim(ctx).todos.read('s')).toHaveLength(1);
    expect(await shim.todos.read('other')).toEqual([]);
    await shim.todos.remove('s');
    expect(await shim.todos.read('s')).toEqual([]);
  });
  test('cleanup fences old clients against late timer prompts', async () => {
    const { session, shim } = fixture();
    shim.dispose();
    await expect(
      shim.client.session.prompt({ path: { id: 's' }, body: { parts: [] } }),
    ).rejects.toThrow('unloaded');
    expect(session.prompt).not.toHaveBeenCalled();
  });
});
