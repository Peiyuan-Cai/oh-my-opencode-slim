import type { Mcp, Model } from '@opencode/plugin';
import type { Permission } from '@opencode/schema/permission';

export type LegacyAgent = Record<string, unknown>;
export type LegacyPart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};
export type LegacyMessage = {
  info: Record<string, unknown>;
  parts: LegacyPart[];
};

export function adaptMcp(entry: Record<string, unknown>): Mcp.ServerConfig {
  const { enabled, timeout, ...server } = entry;
  // V2 optional keys may be absent, but explicitly present undefined values
  // are invalid. Context7's V1 factory emits headers: undefined without a key.
  const defined = Object.fromEntries(
    Object.entries(server).filter(([, value]) => value !== undefined),
  );
  return {
    ...defined,
    ...(enabled === false ? { disabled: true } : {}),
    ...(typeof timeout === 'number'
      ? { timeout: { catalog: timeout, execution: timeout } }
      : {}),
  } as Mcp.ServerConfig;
}

const ACTIONS: Record<string, string> = {
  bash: 'shell',
  task: 'subagent',
  write: 'edit',
  patch: 'edit',
  apply_patch: 'edit',
};

export function adaptPermissions(value: unknown): Array<Permission.Rule> {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return structuredClone(value);
  return Object.entries(value).flatMap(([key, rule]) => {
    const action = ACTIONS[key] ?? key;
    const entries =
      typeof rule === 'string'
        ? [['*', rule]]
        : rule && typeof rule === 'object'
          ? Object.entries(rule)
          : [];
    return entries.flatMap(([resource, effect]) =>
      effect === 'allow' || effect === 'ask' || effect === 'deny'
        ? [{ action, resource, effect }]
        : [],
    );
  });
}

export function parseModel(
  model: unknown,
  variant?: unknown,
): Model.Ref | undefined {
  if (typeof model !== 'string') return undefined;
  const slash = model.indexOf('/');
  if (slash < 1 || slash === model.length - 1) {
    throw new Error(`Invalid OMO1 model reference: ${model}`);
  }
  const [id, embeddedVariant] = model.slice(slash + 1).split('#');
  return {
    providerID: model.slice(0, slash),
    id,
    ...(typeof variant === 'string' || embeddedVariant
      ? { variant: typeof variant === 'string' ? variant : embeddedVariant }
      : {}),
  } as Model.Ref;
}

/** Translate only platform vocabulary, not the OMO1 roles or workflow. */
export function adaptPrompt(text: string): string {
  return text
    .replace(/\bsubagent_type\b/g, 'agent')
    .replace(/\btask_id\b/g, 'sessionID')
    .replace(/`task`/g, '`subagent`')
    .replace(/\btask\(/g, 'subagent(')
    .replace(/`bash`/g, '`shell`')
    .replace(/`apply_patch`/g, '`patch`');
}

export function applyAgent(target: object, source: LegacyAgent): void {
  const agent = target as unknown as Record<string, unknown>;
  const model = parseModel(source.model, source.variant);
  if (model) agent.model = model;
  for (const key of ['description', 'mode', 'hidden', 'color'] as const) {
    if (source[key] !== undefined) agent[key] = source[key];
  }
  if (typeof source.prompt === 'string')
    agent.system = adaptPrompt(source.prompt);
  if (typeof source.system === 'string')
    agent.system = adaptPrompt(source.system);
  const rules = adaptPermissions(source.permission);
  // V1 tools:false is also a permission restriction, never just UI metadata.
  const tools = source.tools as Record<string, boolean> | undefined;
  for (const [key, enabled] of Object.entries(tools ?? {})) {
    if (!enabled)
      rules.push({
        action: ACTIONS[key] ?? key,
        resource: '*',
        effect: 'deny',
      });
  }
  const existing = (agent.permissions ?? []) as Permission.Rule[];
  // Default allow-all must not undo OMO's read-only/no-delegation contracts.
  // Preserve host denials last, including per-file restrictions.
  agent.permissions = [
    ...existing,
    ...rules,
    ...existing.filter((r) => r.effect === 'deny'),
  ];
  if (source.maxSteps !== undefined) agent.steps = source.maxSteps;
}

export function toLegacyTranscript(
  messages: ReadonlyArray<unknown>,
  sessionID: string,
  agent?: string,
): LegacyMessage[] {
  return messages.map((raw) => {
    const message = raw as Record<string, unknown>;
    if (message.type === 'assistant') {
      return {
        info: { ...message, role: 'assistant', sessionID, agent },
        parts: (message.content ?? message.parts ?? []) as LegacyPart[],
      };
    }
    if (message.type === 'user' || message.type === 'synthetic') {
      return {
        info: { ...message, role: 'user', sessionID, agent },
        parts: [{ type: 'text', text: String(message.text ?? '') }],
      };
    }
    return {
      info: { ...message, role: 'system', sessionID, agent },
      parts: [],
    };
  });
}

export function legacyToolName(name: string): string {
  return (
    { subagent: 'task', shell: 'bash', patch: 'apply_patch' }[name] ?? name
  );
}
