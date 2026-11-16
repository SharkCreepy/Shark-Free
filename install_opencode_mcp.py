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


def install(path: Path) -> bool:
    if not MCP_SCRIPT.is_file():
        raise RuntimeError(f"Missing native MCP adapter: {MCP_SCRIPT}")
    config = load_config(path)
    mcp = config.setdefault("mcp", {})
    if not isinstance(mcp, dict):
        raise RuntimeError("The 'mcp' setting is not an object; left config untouched.")
    servers = mcp.setdefault("servers", {})
    if not isinstance(servers, dict):
        raise RuntimeError("The 'mcp.servers' setting is not an object; left config untouched.")
    entry = {
        "type": "local",
        "command": [sys.executable, str(MCP_SCRIPT)],
        "cwd": str(ROOT),
        "environment": {
            "SHARKNYX_BRIDGE_URL": f"ws://127.0.0.1:{os.environ.get('ZS_BRIDGE_PORT', '17613')}"
        },
        "timeout": 180000,
        "codemode": False,
    }
    changed = servers.get(SERVER_ID) != entry
    servers[SERVER_ID] = entry
    save_config(path, config)
    return changed


def remove(path: Path) -> bool:
    if not path.exists():
        return False
    config = load_config(path)
    mcp = config.get("mcp")
    servers = mcp.get("servers") if isinstance(mcp, dict) else None
    if not isinstance(servers, dict) or SERVER_ID not in servers:
        return False
    del servers[SERVER_ID]
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
