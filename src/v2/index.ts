import { resolve } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import type { SessionContext } from '@opencode/plugin/promise/session';
import type { PluginInput } from '@opencode-ai/plugin';
import { z } from 'zod';
import { filterAvailableSkillsText } from '../hooks/filter-available-skills';
import legacyPlugin from '../index';
import {
  adaptMcp,
  adaptPrompt,
  applyAgent,
  type LegacyAgent,
  legacyToolName,
  parseModel,
} from './adapters';
import { createClientShim } from './client-shim';
import { adaptEvent } from './events';

type LegacyHooks = Omit<
  Awaited<ReturnType<typeof legacyPlugin>>,
  'chat.message' | 'experimental.chat.system.transform'
> & {
  agent: Record<string, LegacyAgent>;
  mcp: Record<string, Record<string, unknown>>;
  dispose?: () => void;
  'chat.message': (input: {
    sessionID: string;
    agent?: string;
  }) => Promise<void>;
  'experimental.chat.system.transform': (
    input: { sessionID?: string },
    output: { system: string[] },
  ) => Promise<void>;
};
type LegacyTool = {
  description: string;
  args: Record<string, z.ZodType>;
  execute: (args: unknown, context: unknown) => Promise<string>;
};

const todoSchema = z.object({
  todos: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
      priority: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

export async function setup(ctx: Plugin.Context) {
  const shim = createClientShim(ctx);
  const controller = new AbortController();
  let hooks: LegacyHooks | undefined;
  const registrations: Array<{ dispose(): Promise<void> }> = [];
  const cleanup = async () => {
    controller.abort();
    shim.dispose();
    hooks?.dispose?.();
    for (const registration of registrations.reverse())
      await registration.dispose();
  };
  try {
    hooks = (await legacyPlugin({
      directory: ctx.location.directory,
      project: ctx.location.project,
      client: shim.client,
      hostFlavor: 'v2',
    } as unknown as PluginInput)) as LegacyHooks;
    const legacy = hooks;
    const config: Record<string, unknown> = {};
    await legacy.config?.(config as never);
    const agents = config.agent as Record<string, LegacyAgent>;

    // OMO1 custom variants rely on base methodology plus their file contract.
    // The V2 host reads Markdown bodies, not V1 prompt-frontmatter references.
    for (const [id, definition] of Object.entries(agents)) {
      const base = id.replace(/-(?:alpha|beta|gamma|delta)$/, '');
      if (
        base !== id &&
        agents[base] &&
        typeof definition.prompt === 'string' &&
        definition.prompt.startsWith(`You are the ${id} specialist.`)
      ) {
        definition.prompt = agents[base].prompt;
        definition.permission = {
          ...(agents[base].permission as Record<string, unknown>),
          ...(definition.permission as Record<string, unknown>),
        };
      }
    }

    registrations.push(
      await ctx.agent.transform((editor) => {
        for (const [id, definition] of Object.entries(agents)) {
          if (definition.disable === true) {
            editor.remove(id);
            continue;
          }
          editor.update(id, (agent) => {
            const previousSystem = agent.system;
            applyAgent(agent, definition);
            // V1 hidden variants remained dispatchable; V2 hides them from the
            // subagent tool entirely. Keep specialist variants callable.
            if (
              /-(?:alpha|beta|gamma|delta)$/.test(id) &&
              definition.mode === 'subagent'
            ) {
              agent.hidden = false;
            }
            // Markdown bodies remain user-owned; append their variant contract
            // to the factory's base methodology rather than discarding either.
            if (previousSystem && previousSystem !== agent.system) {
              agent.system = `${agent.system ?? ''}\n\n${adaptPrompt(previousSystem)}`;
            }
          });
        }
        const selected = config.default_agent;
        if (typeof selected === 'string') editor.default(selected);
      }),
    );

    registrations.push(
      await ctx.mcp.transform((editor) => {
        for (const [name, entry] of Object.entries(legacy.mcp)) {
          if (editor.get(name)) continue; // preserve user-owned MCP configuration
          editor.set(name, adaptMcp(entry));
        }
      }),
    );

    registrations.push(
      await ctx.tool.transform((editor) => {
        for (const [name, raw] of Object.entries(legacy.tool ?? {})) {
          const tool = raw as unknown as LegacyTool;
          editor.add({
            name,
            description: adaptPrompt(tool.description),
            input: z.toJSONSchema(z.object(tool.args)) as never,
            options: { codemode: false },
            async execute(input, context) {
              await ctx.permission.assert({
                sessionID: context.sessionID,
                agent: context.agent,
                action: name,
                resources: ['*'],
              });
              if (name === 'ast_grep_search' || name === 'ast_grep_replace') {
                const args = input as { paths?: string[] };
                args.paths = (args.paths?.length ? args.paths : ['.']).map(
                  (path) => resolve(ctx.location.directory, path),
                );
              }
              if (
                name === 'ast_grep_replace' &&
                (input as { dryRun?: boolean }).dryRun === false
              ) {
                await ctx.permission.assert({
                  sessionID: context.sessionID,
                  agent: context.agent,
                  action: 'edit',
                  resources: ['*'],
                });
              }
              const output = await tool.execute(input, {
                ...context,
                callID: context.id,
                abort: context.signal,
                directory: ctx.location.directory,
                worktree: ctx.location.directory,
                metadata: context.progress,
                ask: (request: {
                  permission: string;
                  patterns: string[];
                  always?: string[];
                }) =>
                  ctx.permission.assert({
                    sessionID: context.sessionID,
                    agent: context.agent,
                    action: request.permission,
                    resources: request.patterns,
                    save: request.always,
                  }),
              });
              return { content: output };
            },
          });
        }
        editor.add({
          name: 'todowrite',
          description:
            'Replace the current session todo list. OMO1 auto-continue uses this list.',
          input: z.toJSONSchema(todoSchema) as never,
          options: { codemode: false },
          async execute(input, context) {
            await ctx.permission.assert({
              sessionID: context.sessionID,
              agent: context.agent,
              action: 'todowrite',
              resources: ['*'],
            });
            const { todos } = todoSchema.parse(input);
            await shim.todos.write(context.sessionID, todos);
            return { content: JSON.stringify(todos) };
          },
        });
        editor.add({
          name: 'todoread',
          description: 'Read the current session OMO1 todo list.',
          input: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          options: { codemode: false },
          async execute(_input, context) {
            await ctx.permission.assert({
              sessionID: context.sessionID,
              agent: context.agent,
              action: 'todoread',
              resources: ['*'],
            });
            return {
              content: JSON.stringify(await shim.todos.read(context.sessionID)),
            };
          },
        });
      }),
    );

    registrations.push(
      await ctx.command.transform((editor) => {
        const commands = config.command as Record<
          string,
          { description?: string }
        >;
        for (const [name, command] of Object.entries(commands ?? {})) {
          // /subtask is a template-only V1 command; the subtask tool remains.
          if (name === 'subtask') continue;
          editor.add({
            name,
            description: command.description,
            async execute({ sessionID, prompt, delivery }) {
              const current = await ctx.session.get({ sessionID });
              await legacy['chat.message']?.({
                sessionID,
                agent: current.agent,
              });
              const output = {
                parts: [] as Array<{ type: string; text?: string }>,
              };
              await legacy['command.execute.before']?.(
                {
                  command: name,
                  sessionID,
                  arguments: prompt.text,
                } as never,
                output as never,
              );
              await ctx.session.prompt({
                ...prompt,
                sessionID,
                delivery,
                text: output.parts.map((p) => p.text ?? '').join('\n\n'),
              });
            },
          });
        }
      }),
    );

    const transform = async (event: SessionContext) => {
      await legacy['chat.message']?.({
        sessionID: event.sessionID,
        agent: event.agent,
      });
      const definition = agents[event.agent];
      const configured = parseModel(definition?.model, definition?.variant);
      if (
        definition &&
        configured?.id === event.model.id &&
        configured?.providerID === event.model.providerID &&
        configured?.variant === event.model.variant
      ) {
        if (typeof definition.temperature === 'number')
          event.options.temperature = definition.temperature;
        Object.assign(event.options, definition.options ?? {});
      }
      const messages = event.messages.map((message) => ({
        info: {
          role: message.role,
          sessionID: event.sessionID,
          agent: event.agent,
          id: message.id,
        },
        parts: message.content,
      }));
      const output = { messages };
      await legacy['experimental.chat.messages.transform']?.(
        {} as never,
        output as never,
      );
      event.messages = event.messages.map((message, i) => ({
        ...message,
        content: messages[i].parts,
      })) as SessionContext['messages'];
      // Preserve non-text system parts, including provider identity/cache hints.
      const system = {
        system: event.system
          .filter((p) => p.type === 'text')
          .map((p) => p.text),
      };
      // V2 puts its catalog in system instructions, not a user message.
      const rules = (
        definition?.permission as
          | { skill?: Record<string, 'allow' | 'ask' | 'deny'> }
          | undefined
      )?.skill;
      if (rules)
        system.system = system.system.map((text) =>
          filterAvailableSkillsText(text, rules),
        );
      await legacy['experimental.chat.system.transform']?.(
        { sessionID: event.sessionID },
        system,
      );
      event.system = [
        ...event.system.filter((p) => p.type !== 'text'),
        ...system.system.map((text) => ({
          ...event.system.find((p) => p.type === 'text'),
          type: 'text' as const,
          text: adaptPrompt(text),
        })),
      ];
    };
    registrations.push(await ctx.session.hook('context', transform));
    registrations.push(
      await ctx.tool.hook('execute.before', async (event) => {
        const input = event.input as Record<string, unknown>;
        const args =
          event.tool === 'subagent'
            ? { ...input, subagent_type: input.agent, task_id: input.sessionID }
            : input;
        await legacy['tool.execute.before']?.(
          {
            ...event,
            tool: legacyToolName(event.tool),
            callID: event.id,
          } as never,
          { args } as never,
        );
        if (event.tool === 'subagent') {
          const { subagent_type, task_id, ...rest } = args;
          event.input = {
            ...rest,
            agent: subagent_type,
            ...(task_id ? { sessionID: task_id } : {}),
          };
        } else event.input = args;
      }),
    );
    registrations.push(
      await ctx.tool.hook('execute.after', async (event) => {
        if (event.status !== 'completed') return;
        // Preserve structured image/file results; legacy nudges are text-only.
        const content = event.result.content;
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content) && content.every((p) => p.type === 'text')
              ? content.map((p) => p.text).join('\n')
              : undefined;
        if (text === undefined) return;
        const output = {
          title: '',
          output: text,
          metadata: event.result.metadata ?? {},
        };
        await legacy['tool.execute.after']?.(
          {
            ...event,
            tool: legacyToolName(event.tool),
            callID: event.id,
          } as never,
          output as never,
        );
        event.result = { ...event.result, content: output.output };
      }),
    );

    const sessionDirectories = new Map<string, string>();
    void (async () => {
      for await (const event of ctx.event.subscribe({
        signal: controller.signal,
      })) {
        const mappedEvents = adaptEvent(event);
        if (!mappedEvents.length) continue;
        const data = event.data as {
          sessionID?: string;
          location?: { directory: string };
        };
        const id = data.sessionID;
        if (!id) continue;
        try {
          let directory =
            event.location?.directory ??
            data.location?.directory ??
            sessionDirectories.get(id);
          if (!directory && event.type !== 'session.deleted') {
            directory = (await ctx.session.get({ sessionID: id })).location
              .directory;
          }
          if (directory !== ctx.location.directory) continue;
          sessionDirectories.set(id, directory);
          for (const mapped of mappedEvents) {
            await legacy.event?.({ event: mapped } as never);
            if (mapped.type === 'session.deleted') {
              sessionDirectories.delete(id);
              await shim.todos.remove(id);
            }
          }
        } catch (error) {
          if (!controller.signal.aborted)
            console.error('[OMO1 V2] event handling failed', event.type, error);
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted)
        console.error('[OMO1 V2] event stream failed', error);
    });
    console.info(
      '[OMO1 V2] loaded legacy agent architecture; replay fallback and multiplexer disabled',
    );
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export default { id: 'oh-my-opencode-slim', setup } satisfies Plugin.Plugin;
