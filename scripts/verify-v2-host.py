"""Smoke against a private V2 server; no paid model requests.

Usage: python3 scripts/verify-v2-host.py /path/to/superpowers-lite
Add --mock-model to exercise tools, continuation, delegation, and council
against a localhost-only scripted provider (not an actual LLM).
Build OMO first. Fixtures and diagnostics are kept under /tmp/opencode.
"""
import json
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import secrets
import select
import shutil
import subprocess
import tempfile
import threading
import time


def mock_provider():
    requests = []
    counts = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            model = body["model"]
            counts[model] = counts.get(model, 0) + 1
            requests.append(body)
            tool = None
            text = "Done."
            if model == "manual-override":
                if counts[model] in (1, 3):
                    tool = ("todowrite", {"todos": [{"id": "1", "content": "fixture work",
                            "status": "pending" if counts[model] == 1 else "completed", "priority": "high"}]})
                elif counts[model] == 2:
                    text = "First item finished."
                else:
                    text = "All items completed."
            elif model == "delegation-main" and counts[model] == 1:
                tool = ("subagent", {"agent": "explorer", "description": "Fixture lookup", "prompt": "Return a short fixture result."})
            elif model == "explorer":
                text = "Explorer fixture result."
            elif model == "council" and counts[model] == 1:
                tool = ("council_session", {"prompt": "Review the fixture."})
            elif model in ("council-a", "council-b"):
                text = f"Independent fixture review from {model}."
            delta = {"role": "assistant", "content": text}
            if tool:
                delta = {"role": "assistant", "tool_calls": [{"index": 0,
                         "id": "call_fixture_" + str(len(requests)), "type": "function",
                         "function": {"name": tool[0], "arguments": json.dumps(tool[1])}}]}
            finish = "tool_calls" if tool else "stop"
            if body.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for d, f in [(delta, None), ({}, finish)]:
                    chunk = {"id": "fixture", "object": "chat.completion.chunk", "created": 1,
                             "model": model, "choices": [{"index": 0, "delta": d, "finish_reason": f}]}
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            else:
                result = {"id": "fixture", "object": "chat.completion", "created": 1,
                          "model": model, "choices": [{"index": 0, "message": delta, "finish_reason": finish}],
                          "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, requests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lite", type=Path)
    parser.add_argument("--mock-model", action="store_true")
    parser.add_argument("--personal-config", type=Path,
                        help="read-only snapshot of personal OMO config/agents/prompts/skills; no provider credentials")
    args = parser.parse_args()
    if args.mock_model and args.personal_config:
        parser.error("personal registry checks and scripted inference are separate modes")
    repo = Path(__file__).resolve().parent.parent
    lite = args.lite.resolve()
    root = Path(tempfile.mkdtemp(prefix="omo1-v2-host-", dir="/tmp/opencode"))
    config = root / "config" / "opencode"
    config.mkdir(parents=True)
    project = root / "project"
    project.mkdir()
    agents = {name: {"model": "fixture/" + name, "variant": "high"}
              for name in ["orchestrator", "orchestrator-beta", "orchestrator-delta",
                           "oracle", "fixer", "fixer-alpha", "librarian", "explorer",
                           "designer", "observer", "council", "councillor"]}
    inference = args.mock_model
    provider, requests = mock_provider() if inference else (None, [])
    omo_config = {
        "preset": "superpowers-bridge", "disabled_agents": [],
        "disabled_mcps": ["websearch", "context7", "grep_app"],
        "showStartupToast": False, "fallback": {"enabled": False},
        "todoContinuation": {"cooldownMs": 500, "maxContinuations": 2},
        "superpowersSkillsDir": str(lite / "skills"),
        "presets": {"superpowers-bridge": agents},
        "council": {"default_preset": "default", "presets": {"default": {
            "alpha": {"model": "fixture/council-a", "variant": "high"},
            "beta": {"model": "fixture/council-b", "variant": "high"},
        }}},
    }
    if args.personal_config:
        personal = args.personal_config.resolve()
        load_env = dict(os.environ, OPENCODE_CONFIG_DIR=str(personal))
        load_env.pop("OH_MY_OPENCODE_SLIM_PRESET", None)
        loaded = subprocess.run(["bun", "-e", "import { loadPluginConfig } from './src/config/loader'; console.log(JSON.stringify(loadPluginConfig(process.cwd())));"],
                                cwd=repo, env=load_env, capture_output=True, text=True, check=True)
        omo_config = json.loads(loaded.stdout)
        agents = omo_config["agents"]
        omo_config.update(disabled_mcps=["websearch", "context7", "grep_app"], showStartupToast=False,
                          fallback={"enabled": False}, multiplexer={"type": "none"})
        for name in ["agents", "prompts", "oh-my-opencode-slim", "skills"]:
            if (personal / name).exists():
                shutil.copytree(personal / name, config / name)
        subprocess.run(["bun", "scripts/migrate-v2-agent-files.ts", str(config), "--apply"],
                       cwd=repo, capture_output=True, text=True, check=True)
    (config / "oh-my-opencode-slim.json").write_text(json.dumps(omo_config))
    host_config = {
        "$schema": "https://opencode.ai/config.json",
        "plugins": [str(lite), str(repo)],
        "agents": {"general": {"disabled": True}, "explore": {"disabled": True}},
    }
    if inference:
        host_config["model"] = "fixture/manual-override"
        host_config["agents"]["title"] = {"model": "fixture/title"}
        host_config["providers"] = {"fixture": {
            "package": "@opencode/ai/providers/openai-compatible",
            "settings": {"baseURL": f"http://127.0.0.1:{provider.server_port}/v1", "apiKey": "fixture-not-a-secret"},
            "models": {name: {"capabilities": {"tools": True}, "limit": {"context": 200000, "output": 4000},
                              "variants": [{"id": "high"}]}
                       for name in [*agents, "manual-override", "delegation-main", "council-a", "council-b", "title"]},
        }}
    (config / "opencode.json").write_text(json.dumps(host_config))
    env = dict(os.environ, XDG_CONFIG_HOME=str(root / "config"),
               XDG_DATA_HOME=str(root / "data"), XDG_CACHE_HOME=str(root / "cache"),
               OPENCODE_CONFIG_DIR=str(config), OPENCODE_PASSWORD=secrets.token_hex(24))
    env.pop("OPENCODE_SESSION_ID", None)
    env.pop("OH_MY_OPENCODE_SLIM_PRESET", None)
    with open(root / "server-stderr.log", "w") as errors:
        server = subprocess.Popen(["opencode", "serve", "--stdio", "--port", "0"],
                                  cwd=project, env=env, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=errors, text=True)
        try:
            if not select.select([server.stdout], [], [], 20)[0]:
                raise RuntimeError("Server did not announce a URL")
            url = json.loads(server.stdout.readline())["url"]

            def api(path, method="get", data=None):
                args = ["opencode", "api", "--server", url, method, path,
                        "--param", "location=" + str(project)]
                if data is not None:
                    args += ["--data", json.dumps(data)]
                result = subprocess.run(args,
                                        env=env, cwd=project, capture_output=True, text=True, timeout=30)
                if result.returncode:
                    raise RuntimeError(result.stderr)
                value = json.loads(result.stdout) if result.stdout.strip() else None
                return value.get("data", value) if isinstance(value, dict) else value

            plugins = []
            for _ in range(60):
                plugins = [p for p in api("/api/plugin") if p["source"]["type"] != "builtin"]
                if len(plugins) == 2 and all(p["state"]["status"] in ("active", "failed") for p in plugins):
                    break
                time.sleep(0.1)
            assert len(plugins) == 2 and all(p["state"]["status"] == "active" for p in plugins), plugins
            summary = []
            for name in agents:
                agent = api("/api/agent/" + name)
                model = agents[name]["model"]
                variant = agents[name].get("variant")
                if isinstance(model, list):
                    model = model[0]
                    if isinstance(model, dict):
                        variant = model.get("variant", variant)
                        model = model["id"]
                provider_id, model_id = model.split("/", 1)
                expected_model = {"providerID": provider_id, "id": model_id}
                if variant:
                    expected_model["variant"] = variant
                assert agent["model"] == expected_model, {"id": name, "expected": expected_model, "actual": agent["model"]}
                expected_mode = "primary" if name.startswith("orchestrator") else "all" if name == "council" else "subagent"
                assert agent["mode"] == expected_mode, agent
                assert bool(agent["hidden"]) == (name == "councillor"), agent
                if name.startswith("orchestrator"):
                    assert "@oracle" in agent["system"] and "@fixer" in agent["system"], agent
                summary.append({k: agent.get(k) for k in ["id", "mode", "hidden", "model"]})
            skills = {s["id"] for s in api("/api/skill")}
            assert {"using-superpowers", "brainstorming", "systematic-debugging"} <= skills, skills
            commands = {c["name"] for c in api("/api/command")}
            assert {"auto-continue", "preset"} <= commands, commands
            (root / "summary.json").write_text(json.dumps(summary, indent=2))
            if inference:
                created = api("/api/session", "post", {"agent": "orchestrator-beta",
                              "model": {"providerID": "fixture", "id": "manual-override", "variant": "high"},
                              "location": {"directory": str(project)}})
                sid = created["id"]
                api(f"/api/session/{sid}/command", "post", {"name": "auto-continue", "text": "on"})
                for _ in range(160):
                    main_requests = [r for r in requests if r["model"] == "manual-override"]
                    if len(main_requests) >= 4:
                        break
                    time.sleep(0.1)
                assert len(main_requests) == 4, (len(main_requests), root)
                final = api(f"/api/session/{sid}")
                assert final["agent"] == "orchestrator-beta", final
                assert final["model"] == {"providerID": "fixture", "id": "manual-override", "variant": "high"}, final
                first = json.dumps(main_requests[0])
                assert "SUPERPOWERS_LITE_WORKFLOW" in first and "@oracle" in first, root
                tool_names = {t["function"]["name"] for t in main_requests[0].get("tools", [])}
                assert {"todowrite", "auto_continue", "subagent"} <= tool_names, tool_names
                child_root = api("/api/session", "post", {"agent": "orchestrator-delta",
                                 "model": {"providerID": "fixture", "id": "delegation-main", "variant": "high"},
                                 "location": {"directory": str(project)}})
                api(f"/api/session/{child_root['id']}/prompt", "post", {"text": "Use explorer for this fixture lookup."})
                for _ in range(160):
                    if any(r["model"] == "explorer" for r in requests) and sum(r["model"] == "delegation-main" for r in requests) >= 2:
                        break
                    time.sleep(0.1)
                assert any(r["model"] == "explorer" for r in requests), root
                assert sum(r["model"] == "delegation-main" for r in requests) >= 2, root
                council_root = api("/api/session", "post", {"agent": "council",
                                   "model": {"providerID": "fixture", "id": "council", "variant": "high"},
                                   "location": {"directory": str(project)}})
                api(f"/api/session/{council_root['id']}/prompt", "post", {"text": "Run the fixture council."})
                for _ in range(250):
                    models = [r["model"] for r in requests]
                    if "council-a" in models and "council-b" in models and models.count("council") >= 2:
                        break
                    time.sleep(0.1)
                assert "council-a" in models and "council-b" in models, root
                assert models.count("council") >= 2, root
                council_output = json.dumps([r for r in requests if r["model"] == "council"][-1])
                assert "2/2 councillors responded" in council_output, (council_output[-3000:], root)
                (root / "request-summary.json").write_text(json.dumps([
                    {"model": r["model"], "tools": [t["function"]["name"] for t in r.get("tools", [])]}
                    for r in requests], indent=2))
                print(f"PASS: mock-provider tool execution, auto-continue identity/model, native explorer delegation, 2/2 council reviews; no paid calls. Evidence: {root}")
            else:
                print(f"PASS: two active plugins, {len(summary)} OMO1 agents/models, {len(skills)} skills; no LLM requests. Evidence: {root}")
        finally:
            if inference:
                (root / "mock-requests.json").write_text(json.dumps(requests, indent=2))
            server.terminate()
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
            if provider:
                provider.shutdown()


if __name__ == "__main__":
    main()
