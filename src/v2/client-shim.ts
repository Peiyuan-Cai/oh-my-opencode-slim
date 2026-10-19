import type { Plugin } from '@opencode/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import { adaptPermissions, parseModel, toLegacyTranscript } from './adapters';

type Request = {
  path?: { id: string; messageID?: string };
  body?: Record<string, unknown>;
  query?: { directory?: string; limit?: number };
};

function sessionID(request: Request): string {
  if (!request.path?.id) throw new Error('Missing session ID');
  return request.path.id;
}

/** V2 has no todo API. This store is plugin-owned, not a pretend host endpoint. */
export function createTodoStore(ctx: Plugin.Context) {
  const key = (sessionID: string) => `todos/${sessionID}`;
  return {
    async read(sessionID: string) {
      return ((await ctx.storage.get(key(sessionID))) ?? []) as unknown[];
    },
    async write(sessionID: string, todos: unknown[]) {
      await ctx.storage.set(key(sessionID), todos as never);
    },
    async remove(sessionID: string) {
      await ctx.storage.remove(key(sessionID));
    },
  };
}

export function createClientShim(ctx: Plugin.Context) {
  const todos = createTodoStore(ctx);
  const owned = new Set<string>();
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new Error('OMO1 V2 plugin was unloaded');
  };
  const read = async (sessionID: string) => {
    assertLive();
    const info = await ctx.session.get({ sessionID });
    const messages = await ctx.session.context({ sessionID });
    return toLegacyTranscript(messages, sessionID, info.agent);
  };
  const prompt = async (request: Request, wait: boolean) => {
    assertLive();
    const sessionID = request.path?.id;
    if (!sessionID) throw new Error('Missing session ID');
    const body = request.body ?? {};
    // Only freshly created plugin-owned children may change identity/model.
    // Existing roots always retain the host's persisted selection, including
    // manual switches made during the auto-continue cooldown.
    if (owned.delete(sessionID)) {
      if (typeof body.agent === 'string') {
        await ctx.session.switchAgent({ sessionID, agent: body.agent });
      }
      const ref = body.model as
        | { providerID: string; modelID: string }
        | undefined;
      const model = ref
        ? parseModel(`${ref.providerID}/${ref.modelID}`, body.variant)
        : undefined;
      if (model) await ctx.session.switchModel({ sessionID, model });
      if (body.tools) {
        await ctx.session.update({
          sessionID,
          permissions: adaptPermissions(
            Object.fromEntries(
              Object.entries(body.tools as Record<string, boolean>)
                .filter(([, enabled]) => !enabled)
                .map(([name]) => [name, 'deny']),
            ),
          ),
        });
      }
    } else if (body.agent || body.model || body.variant) {
      // Never emulate per-call overrides with non-atomic switches on a live root.
      // Auto-continue's legacy hints are intentionally ignored: V2 inherits the
      // current persisted pair atomically at prompt admission.
      const parts = body.parts as Array<{ text?: string }> | undefined;
      const internal = parts?.some((p) =>
        /Auto-continue|Auto-Continue/.test(p.text ?? ''),
      );
      if (!internal)
        throw new Error(
          'V2 cannot safely override a live session agent/model per prompt',
        );
    }
    const parts = (body.parts ?? []) as Array<{
      type: string;
      text?: string;
      url?: string;
      filename?: string;
    }>;
    assertLive();
    const result = await ctx.session.prompt({
      sessionID,
      text: parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('\n\n'),
      files: parts
        .filter((p) => p.type === 'file' && p.url)
        .map((p) => ({ uri: p.url as string, name: p.filename })),
      delivery: body.noReply ? 'queue' : 'steer',
      ...(body.noReply ? { resume: false } : {}),
      ...(typeof body.messageID === 'string' ? { id: body.messageID } : {}),
    });
    if (wait && !body.noReply) {
      await ctx.session.wait({ sessionID });
      const messages = await read(sessionID);
      const last = messages.findLast((m) => m.info.role === 'assistant');
      return { data: last ?? result };
    }
    return { data: result };
  };
  const session = {
    get: async (r: Request) => ({
      data: await ctx.session.get({ sessionID: sessionID(r) }),
    }),
    create: async (r: Request) => {
      assertLive();
      const info = await ctx.session.create({
        ...r.body,
        location: { directory: r.query?.directory ?? ctx.location.directory },
      });
      owned.add(info.id);
      return { data: info };
    },
    messages: async (r: Request) => ({ data: await read(sessionID(r)) }),
    message: async (r: Request) => ({
      data: (await read(sessionID(r))).find(
        (m) => m.info.id === r.path?.messageID,
      ),
    }),
    prompt: (r: Request) => prompt(r, true),
    promptAsync: (r: Request) => prompt(r, false),
    abort: async (r: Request) => ({
      data: await ctx.session.interrupt({
        sessionID: sessionID(r),
        resume: false,
      }),
    }),
    delete: async (r: Request) => ({
      data: await ctx.session.remove({ sessionID: sessionID(r) }),
    }),
    update: async (r: Request) => ({
      data: await ctx.session.update({ sessionID: sessionID(r), ...r.body }),
    }),
    todo: async (r: Request) => ({ data: await todos.read(sessionID(r)) }),
  };
  const client = {
    session,
    app: {
      agents: async () => ({
        data: (await ctx.agent.list()).data.map((a) => ({
          ...a,
          name: a.id,
          prompt: a.system,
        })),
      }),
      log: async () => ({ data: true }),
    },
    tool: {
      ids: async () => ({ data: (await ctx.tool.list()).map((t) => t.id) }),
    },
    tui: { showToast: async () => ({ data: false }) },
  };
  return {
    client: client as unknown as PluginInput['client'],
    todos,
    dispose() {
      disposed = true;
      owned.clear();
    },
  };
}
