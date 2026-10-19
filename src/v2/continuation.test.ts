import { expect, mock, test } from 'bun:test';
import type { Plugin } from '@opencode/plugin';
import { createTodoContinuationHook } from '../hooks/todo-continuation';
import { createClientShim } from './client-shim';
import { adaptEvent } from './events';

function fixture() {
  const selection = {
    agent: 'orchestrator-beta',
    model: { providerID: 'manual', id: 'override', variant: 'xhigh' },
  };
  const observed: unknown[] = [];
  const values = new Map();
  const session = {
    get: async () => ({ id: 's', ...selection }),
    prompt: mock(async () => {
      observed.push(structuredClone(selection));
      return {};
    }),
    wait: async () => {},
    context: async () => [
      {
        type: 'assistant',
        content: [{ type: 'text', text: 'One item finished.' }],
      },
    ],
    switchAgent: mock(async () => {}),
    switchModel: mock(async () => {}),
  };
  const ctx = {
    session,
    storage: {
      get: async (k: string) => values.get(k),
      set: async (k: string, v: unknown) => {
        values.set(k, v);
      },
    },
  } as unknown as Plugin.Context;
  const shim = createClientShim(ctx);
  const hook = createTodoContinuationHook({ client: shim.client } as never, {
    notify: false,
    cooldownMs: 30,
    getSessionAgent: () => 'orchestrator-beta',
  });
  hook.handleChatMessage({ sessionID: 's', agent: 'orchestrator-beta' });
  return { selection, observed, session, shim, hook };
}

test('real OMO1 auto-continue hook retains agent AND model changed during cooldown', async () => {
  const f = fixture();
  try {
    await f.shim.todos.write('s', [
      { id: '1', content: 'pending', status: 'pending' },
    ]);
    const tool = f.hook.tool.auto_continue as {
      execute(args: { enabled: boolean }): Promise<string>;
    };
    await tool.execute({ enabled: true });
    await f.hook.handleEvent({
      event: adaptEvent({
        type: 'session.execution.succeeded',
        data: { sessionID: 's' },
      })[0],
    });
    f.selection.agent = 'orchestrator-delta';
    f.selection.model.id = 'new-user-override';
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(f.session.prompt).toHaveBeenCalledTimes(1);
    expect(f.observed[0]).toEqual({
      agent: 'orchestrator-delta',
      model: {
        providerID: 'manual',
        id: 'new-user-override',
        variant: 'xhigh',
      },
    });
    expect(f.session.switchAgent).not.toHaveBeenCalled();
    expect(f.session.switchModel).not.toHaveBeenCalled();
  } finally {
    f.hook.dispose();
    f.shim.dispose();
  }
});

test('V2 interruption cancels an OMO1 pending continuation', async () => {
  const f = fixture();
  try {
    await f.shim.todos.write('s', [
      { id: '1', content: 'pending', status: 'pending' },
    ]);
    const tool = f.hook.tool.auto_continue as {
      execute(args: { enabled: boolean }): Promise<string>;
    };
    await tool.execute({ enabled: true });
    for (const type of [
      'session.execution.succeeded',
      'session.execution.interrupted',
    ]) {
      await f.hook.handleEvent({
        event: adaptEvent({ type, data: { sessionID: 's' } })[0],
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(f.session.prompt).not.toHaveBeenCalled();
  } finally {
    f.hook.dispose();
    f.shim.dispose();
  }
});
