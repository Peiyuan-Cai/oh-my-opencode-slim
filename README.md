# OMO1 + OpenCode V2 — Peiyuan-Cai fork

This fork preserves the **OMO Slim 1.1.2 multi-agent architecture**, personal
workflow customizations, and Superpowers Lite integration while adapting the
host boundary to **OpenCode 2.0.32**. It does **not** adopt OMO2/OMO3's agent
architecture and does not auto-upgrade to the upstream npm package.

The default `master` publishes this maintained, clone-ready architecture;
`feat/opencode-v2-compat` also carries the compatibility source. Original upstream
`master` is retained at `upstream-master-before-v2-20261019` as a reference.
The original MIT license and upstream history are retained.

## The three repositories

| Repository | Responsibility |
| --- | --- |
| [oh-my-opencode-slim](https://github.com/Peiyuan-Cai/oh-my-opencode-slim) | This runnable OMO1 fork: orchestrators, specialist agents, tools, continuation, council, and V2 adapter. |
| [superpowers-lite](https://github.com/Peiyuan-Cai/superpowers-lite) | Runnable skill/bootstrap plugin; canonical Lite workflow policy. |
| [omo-slim-superpowers-patch-kit](https://github.com/Peiyuan-Cai/omo-slim-superpowers-patch-kit) | Installer, native agent/prompt/skill assets, integration tests, and historical patches. Not a runtime plugin. |

Only **Lite and this OMO checkout** are registered as runtime plugins. This fork
already contains the historical bridge patches: **do not apply them again**.
Clone all three user-owned repositories as siblings; no fourth checkout or
stock Superpowers installation is required.

## Install from source

Prerequisites: Git, Bun 1.3.1 or newer, Node.js 22 for auxiliary tests, and
OpenCode V2. The validated host is 2.0.32; other versions need verification.
Python 3 is needed only for host smoke tests. Configure your own model provider
and credentials in OpenCode; no account or API key is shipped in these repos.

```sh
git clone https://github.com/Peiyuan-Cai/superpowers-lite
git clone https://github.com/Peiyuan-Cai/oh-my-opencode-slim
git clone https://github.com/Peiyuan-Cai/omo-slim-superpowers-patch-kit

cd oh-my-opencode-slim
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../omo-slim-superpowers-patch-kit

# Replace provider/model with an ID available in your OpenCode setup.
bun scripts/install-v2.ts --model provider/model
# Review the dry run before applying it:
bun scripts/install-v2.ts --model provider/model --apply
```

The installer backs up changed configuration, computes local paths, installs
the native assets, and preserves unrelated providers/MCP settings. It does not
clone repositories, install dependencies, start a model request, or restart the
shared OpenCode service. Read its
[full installation guide](https://github.com/Peiyuan-Cai/omo-slim-superpowers-patch-kit/blob/feat/opencode-v2-compat/docs/install-v2.md)
before changing an existing setup. Restart/reload the intended host when ready.

## Preserved architecture

- Primary `orchestrator`, `orchestrator-beta`, and `orchestrator-delta` profiles.
- Explorer, librarian, oracle, designer, fixer, observer, council/councillor,
  custom laborer, best-of-N variants, and narrow utility agents.
- Existing preset/model mapping, prompt bridges, native subagent delegation,
  Lite skill policy, and persistent plugin-owned todo tools.
- Auto-continue retains the **active orchestrator variant AND manually selected
  model/variant**, rather than resetting either to a preset default.
- Council runs its configured model seats and returns results for synthesis.

V1 and V2 have separate entrypoints: `dist/index.js` for the original V1 factory,
and root `server.js` / package `./server` for the V2 adapter. The source is the
maintained artifact; build `dist/` locally rather than downloading upstream
`oh-my-opencode-slim@latest`.

## Compatibility boundaries

- V1 countdown/status messages are omitted on V2 to avoid queuing extra model
  turns. Actual continuation, interruption, and timer cleanup are retained.
- V1 automatic abort/switch/replay fallback is disabled on V2; model-array
  startup selection and manual model selection remain.
- Legacy tmux/zellij viewers and TUI enhancements are not ported; use V2's
  native child-session interface.
- Interview dashboard/transcript support and webfetch secondary-model summaries
  are not host-verified. `/subtask` is not registered, while its tool is bridged.
- V2 keeps session agent and model selection separate: select the desired model
  explicitly when switching primary agents.
- V2 AST tools require explicit files selected with native `glob` first. They
  enforce file-specific read/edit permissions instead of recursively scanning
  unauthorized directories. Leaf agents cannot spawn privileged `subtask` workers.

See [the adapter guide](docs/opencode-v2-omo1.md) for details and old agent-file
migration. [Historical V1 documentation](README.v1.md) is retained for provenance;
its npm install, automatic update, and older UI instructions are not the V2 path.

## Verify without paid model calls

```sh
bun run check:ci
bun run typecheck
bun test
bun run build
bun run verify:release
python3 scripts/verify-v2-host.py ../superpowers-lite --mock-model
```

The mock smoke starts a private server and localhost scripted provider. It
checks registration, tool execution, identity-preserving continuation, native
explorer delegation, and two council seats. It does not call a paid model and is
not an evaluation of real LLM reasoning quality.

## Attribution

Derived from [alvinunreal/oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)
at the OMO1 v1.1.2 baseline (`89f7a4025f2547584aa91c674fc508593a668006`). Bridge
work originates in [BB-84C's patch kit](https://github.com/BB-84C/omo-slim-superpowers-patch-kit).
Lite is maintained separately with its original authorship and MIT license.
This fork is maintained by Peiyuan-Cai and is not an upstream OMO2/OMO3 release.
