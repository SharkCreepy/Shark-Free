#!/usr/bin/env python3
"""Register or remove SharkNyx as a native OpenCode MCP server.

Called automatically by start.bat after Python and websockets are available.
It merges one named server into OpenCode's global config without replacing
other settings, and backs up an existing config before changing it.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SERVER_ID = "sharknyx-roblox"
ROOT = Path(__file__).resolve().parent
MCP_SCRIPT = ROOT / "sharknyx_opencode_mcp.py"


def config_path() -> Path:
    return Path.home() / ".config" / "opencode" / "opencode.json"


def _strip_jsonc(text: str) -> str:
    """Remove // and /* */ comments and trailing commas outside JSON strings."""
    out: list[str] = []
    i = 0
    in_string = False
    escaped = False
    while i < len(text):
        ch = text[i]
        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < len(text) and text[i + 1] == "/":
            i += 2
            while i < len(text) and text[i] not in "\r\n":
                out.append(" ")
                i += 1
            continue
        if ch == "/" and i + 1 < len(text) and text[i + 1] == "*":
            i += 2
            while i + 1 < len(text) and text[i:i + 2] != "*/":
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            i = min(i + 2, len(text))
            continue
        out.append(ch)
        i += 1

    clean = "".join(out)
    out = []
    i = 0
    in_string = False
    escaped = False
    while i < len(clean):
        ch = clean[i]
        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == ",":
            j = i + 1
            while j < len(clean) and clean[j].isspace():
                j += 1
            if j < len(clean) and clean[j] in "]}":
                i += 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def load_config(path: Path) -> dict:
    if not path.exists():
        return {"$schema": "https://opencode.ai/config.json"}
    text = path.read_text(encoding="utf-8-sig")
    try:
        config = json.loads(_strip_jsonc(text))
    except Exception as exc:
        raise RuntimeError(f"Could not parse {path}; left it untouched. {exc}") from exc
    if not isinstance(config, dict):
        raise RuntimeError(f"Expected a JSON object in {path}; left it untouched.")
    return config


def _entry() -> dict:
    bridge_port = os.environ.get("ZS_BRIDGE_PORT", "17613")
    return {
        "type": "local",
        "command": [sys.executable, str(MCP_SCRIPT)],
        "cwd": str(ROOT),
        "environment": {"SHARKNYX_BRIDGE_URL": f"ws://127.0.0.1:{bridge_port}"},
        "timeout": 180000,
        "codemode": False,
    }


def _server_map(mcp: dict):
    nested = mcp.get("servers")
    if isinstance(nested, dict):
        return nested, "nested"
    direct = mcp.get(SERVER_ID)
    if isinstance(direct, dict):
        return mcp, "direct"
    if any(
        isinstance(value, dict) and value.get("type") in ("local", "remote")
        for value in mcp.values()
    ):
        return mcp, "direct"
    return None, None


def _backup_config(path: Path) -> None:
    if path.exists():
        backup = path.with_suffix(path.suffix + ".bak")
        if not backup.exists():
            backup.write_bytes(path.read_bytes())


def _configure_entry(config: dict, entry: dict) -> bool:
    mcp = config.setdefault("mcp", {})
    if not isinstance(mcp, dict):
        raise RuntimeError("The 'mcp' setting is not an object; left config untouched.")
    servers, form = _server_map(mcp)
    if servers is None:
        # Current OpenCode config uses mcp.servers. Older Windows builds have
        # accepted server entries directly under mcp; use that shape only when
        # no CLI is available to write the installed version's preferred form.
        if os.name == "nt":
            servers, form = mcp, "direct"
        else:
            servers = mcp.setdefault("servers", {})
            form = "nested"
    if not isinstance(servers, dict):
        raise RuntimeError("The OpenCode MCP server list is not an object; left config untouched.")
    configured = dict(entry)
    if form == "direct" and os.name == "nt":
        configured["enabled"] = True
    changed = servers.get(SERVER_ID) != configured
    servers[SERVER_ID] = configured
    return changed


def install(path: Path | None = None) -> bool:
    if not MCP_SCRIPT.is_file():
        raise RuntimeError(f"Missing native MCP adapter: {MCP_SCRIPT}")
    use_cli = path is None
    path = path or config_path()
    entry = _entry()
    config = load_config(path)
    mcp = config.get("mcp") if isinstance(config.get("mcp"), dict) else {}
    servers, _ = _server_map(mcp)
    if servers is not None and servers.get(SERVER_ID) == entry:
        return False

    cli = shutil.which("opencode") if use_cli else None
    if cli:
        _backup_config(path)
        command = [
            cli, "mcp", "add", SERVER_ID, "--global",
            "--env", f"SHARKNYX_BRIDGE_URL={entry['environment']['SHARKNYX_BRIDGE_URL']}",
            "--", sys.executable, str(MCP_SCRIPT),
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        except Exception as exc:
            result = None
            print(f"OpenCode CLI registration unavailable; using config fallback ({exc}).", file=sys.stderr)
        if result is not None and result.returncode == 0:
            if result.stdout.strip():
                print(result.stdout.strip())
            config = load_config(path)
            changed = _configure_entry(config, entry)
            save_config(path, config)
            return changed
        if result is not None:
            message = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
            print(f"OpenCode CLI registration failed; using config fallback ({message}).", file=sys.stderr)

    changed = _configure_entry(config, entry)
    save_config(path, config)
    return changed


def remove(path: Path) -> bool:
    if not path.exists():
        return False
    config = load_config(path)
    mcp = config.get("mcp")
    if not isinstance(mcp, dict):
        return False
    removed = False
    nested = mcp.get("servers")
    if isinstance(nested, dict) and SERVER_ID in nested:
        del nested[SERVER_ID]
        removed = True
    if SERVER_ID in mcp and isinstance(mcp[SERVER_ID], dict):
        del mcp[SERVER_ID]
        removed = True
    if not removed:
        return False
    save_config(path, config)
    return True


def save_config(path: Path, config: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    current = None
    if path.exists():
        current = path.read_text(encoding="utf-8-sig")
        try:
            if json.loads(_strip_jsonc(current)) == config:
                return
        except Exception:
            pass
        backup = path.with_suffix(path.suffix + ".bak")
        if not backup.exists():
            backup.write_text(current, encoding="utf-8")
    fd, temp_name = tempfile.mkstemp(prefix="opencode-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(rendered)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remove", action="store_true", help="remove the SharkNyx MCP entry")
    args = parser.parse_args()
    path = config_path()
    try:
        if args.remove:
            changed = remove(path)
            print("Removed SharkNyx from OpenCode config." if changed else "SharkNyx was not registered.")
        else:
            changed = install(path)
            if changed:
                print(f"Registered SharkNyx for OpenCode in: {path}")
            else:
                print(f"SharkNyx is already registered for OpenCode in: {path}")
            print("Restart OpenCode after start.bat has started the SharkNyx bridge.")
        return 0
    except Exception as exc:
        print(f"OpenCode integration setup failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
