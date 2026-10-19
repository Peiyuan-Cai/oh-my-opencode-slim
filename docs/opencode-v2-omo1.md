# OpenCode V2 adapter for the local OMO1 architecture

This branch ports the **existing patched OMO Slim 1.1.2** architecture. It does
not upgrade to OMO2/OMO3, replace the specialist roles, or import their new
orchestration architecture. The original V1 entrypoint remains `dist/index.js`.
V2 loads `server.js` / the package's `./server` export (`dist/v2/index.js`).

## Build and enable

Build this checkout first:

```sh
bun install --ignore-scripts
bun run build
```

Merge these entries into `opencode.json(c)`, replacing the old Lite single-file
entry and the old OMO entry. Do not load both the old and new registrations:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/superpowers-lite",
    "/absolute/path/to/oh-my-opencode-slim"
  ]
}
```

Use the V2-compatible Lite branch (with its root `server.js`). Keep Lite before
OMO. Existing `oh-my-opencode-slim.jsonc`, `superpowersSkillsDir`, presets,
prompt bridges, and Markdown agents remain the input; no provider, credential,
MCP, or unrelated host config rewrite is required.

For V1 Markdown variants, preview the small agent-file migration:

```sh
bun scripts/migrate-v2-agent-files.ts /path/to/opencode-config
# Only when ready to change that configuration:
bun scripts/migrate-v2-agent-files.ts /path/to/opencode-config --apply
```

This expands `{file:...}` prompt-frontmatter references into the Markdown body
and makes named best-of-N variants dispatchable. Explicit Markdown fields have
host precedence over plugin transforms, so an existing `hidden: true` cannot be
reliably undone by plugin code alone. `--apply` backs up every changed file under
`migration-backups/` (outside `agents/`). It is idempotent, leaves unrelated
fields alone, and defaults to a dry run. The private personal-config smoke below
applies it only to temporary copies, never the real files.

Validation below does not edit the real host config or restart the shared
service. Enabling this in normal sessions is a separate operator action. Back up
the host config first, then reload/restart the relevant host when ready. Existing
sessions retain their persisted agent/model selection.

## Preserved behavior

- The OMO1 orchestrator, specialist factories, custom agents, and presets.
- `orchestrator-beta` / `orchestrator-delta` primary entries, specialist models
  and reasoning variants, and inherited base methodology for named variants.
- Native V2 `subagent` delegation (old task argument/permission vocabulary is
  adapted at the boundary).
- Lite's shared skill bodies, bootstrap, and OMO1 skill permissions/filtering.
- `/auto-continue`, `/goal`, `/preset` (save, then host reload to apply), and
  plugin-owned persistent `todowrite` / `todoread` tools.
- Auto-continuation inherits the **current persisted agent AND model/variant**.
  It does not issue a model/agent switch or reapply preset defaults. Manual
  changes during the cooldown therefore survive. Errors/interruption do not
  become successful idle; unloading cancels continuation timers.
- Council uses the existing CouncilManager with isolated new councillor
  sessions, their configured models, and collected results for synthesis.
- Existing custom tools are bridged with JSON schemas and permission checks.
  AST tool paths resolve against the location, not the shared server's cwd.

## Deliberate differences / remaining validation

- **Countdown/status notifications are omitted on V2.** V1 `noReply` status text
  is not a transient message on V2: queuing it can cause an extra model turn
  later. The actual continuation and cancellation gates remain.
- **Automatic foreground replay/failover is disabled on V2.** The V1 abort +
  switch + replay implementation cannot safely emulate a per-turn atomic
  selection change. Model-array startup selection remains. Manual model
  selection remains available; do not mistake the disabled runtime fallback for
  an active feature.
- **V1 tmux/zellij viewers and TUI enhancements are not ported.** Use native V2
  child-session interfaces. Do not point V1 `opencode attach` viewers at V2.
- `/subtask` is not registered on V2; its `subtask` tool is bridged. Interview
  dashboard/transcript integrations and secondary-model webfetch summaries are
  not host-verified. They must not be treated as fully migrated features.
- The V2 selector keeps the session model separate from its agent selection.
  Select the desired model explicitly when changing a primary agent; the
  adapter deliberately does not switch a live session's model behind your back.
- V1 hidden best-of-N variants were still dispatchable. V2 excludes hidden
  agents from its subagent catalog, so named specialist variants are visible
  there; internal `councillor` remains hidden and is launched by CouncilManager.
- Only `@opencode/plugin` **2.0.32** is compile-time checked. Host verification
  is against OpenCode **2.0.32**, not a claim about every V2 release.

## Verification

```sh
bun run check:ci
bun run typecheck
bun test
bun run build
python3 scripts/verify-v2-host.py /absolute/path/to/superpowers-lite
python3 scripts/verify-v2-host.py /absolute/path/to/superpowers-lite --mock-model
python3 scripts/verify-v2-host.py /absolute/path/to/superpowers-lite --personal-config /path/to/opencode-config
```

The Python smoke starts and terminates a private server with temporary config,
data, and cache under `/tmp/opencode`. It checks plugin state, the OMO1 agent
registry, model/variant mappings, skills, and commands. `--mock-model` additionally
uses a localhost scripted OpenAI-compatible provider to exercise real host tool
execution, continuation, native explorer delegation, and two council seats. It
makes **no paid model calls** and is not a semantic evaluation of an actual LLM.

Before using the complete personal configuration, read back all custom agent
permissions, model availability, and prompts in a private host. Preserve the
local pre-migration source backup: this checkout contains additional local work
beyond the published patch-kit snapshot.
