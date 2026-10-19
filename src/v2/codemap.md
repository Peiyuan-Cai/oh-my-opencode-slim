# src/v2/

OpenCode 2.0.32 boundary adapter for the existing local OMO1 factory.

- `index.ts`: composes the V1 factory with domain transforms, custom tools,
  command executors, context/tool hooks, a location-scoped event pump, and
  cleanup. Does not replace the OMO1 specialist architecture.
- `adapters.ts`: translates agent/model/permission fields, platform vocabulary,
  and transcript envelopes. Keeps host denials and specialist roles.
- `client-shim.ts`: narrowly implements V1-shaped client calls using real V2
  session methods. Only new plugin-owned children get initial selection
  switches; live roots inherit persisted selection. Owns persistent todo data.
- `events.ts`: maps native execution events to the V1 lifecycle consumers.
  Only success produces idle; failure/interruption cannot trigger continuation.
- `tool-permissions.ts`: enforces delegation permissions for subtask and exact
  canonical read/edit/external-directory resources for explicit-file AST calls.
- `agent-files.ts`: idempotent V1 Markdown compatibility conversion, invoked by
  the dry-run/backup-aware `scripts/migrate-v2-agent-files.ts` CLI. Required for
  explicit file fields that take precedence over plugin transforms.
- `*.test.ts`: platform translation, storage, identity-preserving continuation,
  cancellation, and unload fences.

Build: `server.js` and the package `./server` export load `dist/v2/index.js`.
Host smoke: `scripts/verify-v2-host.py`. Feature boundaries and installation:
`docs/opencode-v2-omo1.md`.
