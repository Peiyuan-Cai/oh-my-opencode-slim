# src/hooks/foreground-fallback/

## Responsibility

Provides reactive model fallback for foreground (interactive) sessions when
OpenCode reports a retryable/rate-limited run at runtime. It is a safety net
for limits that startup-time model selection could not avoid.

## Design

- `index.ts` exports:
  - `ForegroundFallbackManager`
  - `isRateLimitError(error)`
- Manager state is session-scoped maps for:
  - active model (`sessionModel`)
  - mapped agent (`sessionAgent`)
  - attempted models (`sessionTried`)
  - task/subagent child sessions (`childSessions`)
  - dedupe timestamp (`lastTrigger`)
  - in-flight fallback lock (`inProgress`)
- It also owns a persistent cooldown store. Anthropic reset headers from
  structured API errors are captured and used as soft skip hints during chain
  walking.
- Rate-limit detection is behavior/structure based, not provider-message regex:
  - `message.updated` inspects structured `info.error`.
  - `session.error` inspects structured `properties.error`.
  - `session.status` with `status.type === 'retry'` triggers fallback directly.
  - `isRateLimitError` unwraps plugin-visible API errors and accepts
    `data.isRetryable === true` or `data.statusCode === 429`.
- Foreground sessions whose known agent is the literal `orchestrator` take a
  one-shot pivot path instead of chain walking: `orchestrator` ->
  `orchestrator-beta` on `gauge-forge-openai/gpt-5.4`.
- Fallback selection is deterministic via `resolveChain(agentName, currentModel)`:
  1. exact agent chain (if known)
  2. no fallback if agent is known but unconfigured
  3. infer chain from current model
  4. deduplicated flattening of all chains as fallback.
- Known agents do not bleed into other agents' chains. This means known child
  agents can still no-op when no chain entry exists for that agent.

## Flow

1. `handleEvent` receives each OpenCode event from the plugin’s global event
   surface.
2. `session.created` and `subagent.session.created` mark child sessions; child
   sessions are pre-routed elsewhere and mid-flight fallback is deliberately
   disabled here to avoid racing parent/task completion.
3. On `message.updated`, `session.error`, or retry `session.status`, the manager
   captures cooldown data when present and calls `tryFallback(sessionID)`.
4. `tryFallback` chooses between:
   - orchestrator pivot, for a non-child session currently identified as
     `orchestrator`, or
   - generic chain walking for other eligible foreground sessions.
5. The orchestrator pivot fetches the last user turn, aborts the current session,
   waits briefly (500ms), then replays the same user parts with
   `session.promptAsync` using `agent: 'orchestrator-beta'` and model
   `gauge-forge-openai/gpt-5.4`. It updates both session identity and model.
6. Chain walking uses guards (in-progress lock and 5000ms dedupe), resolves the
   session’s chain, marks the current model as tried, prefers an untried model
   not currently cooling down, aborts foreground sessions, and replays the last
   user turn with the selected model. Foreground replay is non-blocking via
   `promptAsync`.
7. On success it updates `sessionModel`; on failures it logs structured fallback
   or pivot errors.
8. On `session.deleted`, all per-session maps are removed to prevent memory
   growth.

## Integration

- Wired via plugin-level `event` hook in `src/index.ts`.
- Uses `ctx.client.session` APIs (`messages`, `abort`, `promptAsync`) and is
  independent of delegation/council logic.
- The constructor receives a plugin-level root identity sync callback. After the
  orchestrator pivot, the manager calls it so the shared `sessionAgentMap` also
  records `orchestrator-beta`; later plugin logic, including root-aware subagent
  routing, sees the pivoted identity.
