#!/usr/bin/env python3
"""Expose SharkNyx's local WebSocket bridge as a native stdio MCP server.

OpenCode launches this process from its MCP configuration. The adapter forwards
MCP tools/list and tools/call requests to the already-running SharkNyx bridge,
which in turn routes calls to Roblox Studio's MCP server.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import os
import sys
from typing import Any

try:
    import websockets
except ImportError:
    print("SharkNyx MCP: install websockets by running start.bat first.", file=sys.stderr)
    raise

BRIDGE_URL = os.environ.get("SHARKNYX_BRIDGE_URL", "ws://127.0.0.1:17613")
MAX_MESSAGE = 16 * 1024 * 1024
_ids = itertools.count(1)


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


async def _bridge_request(payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    """Open one localhost socket, consume the bridge hello, and await one reply."""
    rid = next(_ids)
    async with websockets.connect(
        BRIDGE_URL,
        open_timeout=5,
        close_timeout=2,
        ping_interval=20,
        ping_timeout=20,
        max_size=MAX_MESSAGE,
    ) as ws:
        # The bridge sends its current status/catalogue as an unsolicited hello
        # immediately after each connection. Consume it before issuing our call.
        await asyncio.wait_for(ws.recv(), timeout=15)
        request = dict(payload)
        request["id"] = rid
        await ws.send(json.dumps(request, ensure_ascii=False))
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise TimeoutError("SharkNyx bridge did not answer before the MCP timeout.")
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
            try:
                response = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if response.get("id") == rid:
                return response


def _mcp_tool(tool: dict[str, Any]) -> dict[str, Any] | None:
    name = tool.get("name")
    if not isinstance(name, str) or not name:
        return None
    out: dict[str, Any] = {
        "name": name,
        "description": tool.get("description") or f"Call the {name} tool through SharkNyx.",
        "inputSchema": tool.get("inputSchema") or tool.get("input_schema") or {
            "type": "object", "properties": {}
        },
    }
    # Preserve standard optional MCP fields, but omit SharkNyx-only `server`.
    for key in ("title", "annotations", "outputSchema"):
        if key in tool:
            out[key] = tool[key]
    return out


def _tool_result(request_id: Any, response: dict[str, Any]) -> dict[str, Any]:
    if not response.get("ok"):
        detail = response.get("error") or "The SharkNyx bridge reported a tool error."
        return {
            "jsonrpc": "2.0", "id": request_id,
            "result": {"content": [{"type": "text", "text": str(detail)}], "isError": True},
        }
    content: list[dict[str, Any]] = []
    text = response.get("text")
    if text:
        content.append({"type": "text", "text": str(text)})
    for image in response.get("images") or []:
        if not isinstance(image, dict) or not image.get("data"):
            continue
        content.append({
            "type": "image",
            "data": image["data"],
            "mimeType": image.get("mimeType") or "image/jpeg",
        })
    if not content:
        content.append({"type": "text", "text": "Tool completed with no text output."})
    return {"jsonrpc": "2.0", "id": request_id, "result": {"content": content, "isError": False}}


async def dispatch(request: dict[str, Any]) -> dict[str, Any] | None:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    # JSON-RPC notifications do not receive a response.
    if request_id is None:
        return None

    if method == "initialize":
        protocol = params.get("protocolVersion") or "2025-03-26"
        return {
            "jsonrpc": "2.0", "id": request_id,
            "result": {
                "protocolVersion": protocol,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "sharknyx-roblox-bridge", "version": "1.0.0"},
                "instructions": (
                    "These tools operate Roblox Studio through the user's SharkNyx bridge. "
                    "The user must start start.bat and have Roblox Studio's MCP server enabled. "
                    "Use only the exposed tool schemas; do not invent tool names or arguments."
                ),
            },
        }

    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}

    if method == "tools/list":
        try:
            response = await _bridge_request({"type": "list_tools"}, timeout=60)
            if response.get("type") == "error":
                raise RuntimeError(response.get("error", "Bridge error"))
            tools = [_mcp_tool(tool) for tool in response.get("tools", [])]
            return {
                "jsonrpc": "2.0", "id": request_id,
                "result": {"tools": [tool for tool in tools if tool is not None]},
            }
        except Exception as exc:
            return _error(request_id, -32002, f"SharkNyx bridge unavailable at {BRIDGE_URL}: {exc}")

    if method == "tools/call":
        name = params.get("name")
        if not isinstance(name, str) or not name:
            return _error(request_id, -32602, "tools/call requires a tool name")
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            return _error(request_id, -32602, "tool arguments must be a JSON object")
        timeout = float(os.environ.get("SHARKNYX_TOOL_TIMEOUT", "180"))
        try:
            response = await _bridge_request({
                "type": "call_tool",
                "name": name,
                "arguments": arguments,
                "timeout": int(timeout * 1000),
            }, timeout=timeout + 10)
            if response.get("type") == "error":
                return _tool_result(request_id, {"ok": False, "error": response.get("error")})
            return _tool_result(request_id, response)
        except Exception as exc:
            return _tool_result(request_id, {
                "ok": False,
                "error": f"Could not reach the SharkNyx bridge at {BRIDGE_URL}: {exc}. Run start.bat and retry.",
            })

    return _error(request_id, -32601, f"Method not found: {method}")


def _process_line(line: str) -> None:
    try:
        request = json.loads(line)
    except json.JSONDecodeError as exc:
        _write(_error(None, -32700, f"Invalid JSON: {exc}"))
        return
    if isinstance(request, list):
        for item in request:
            if isinstance(item, dict):
                response = asyncio.run(dispatch(item))
                if response is not None:
                    _write(response)
        return
    if not isinstance(request, dict):
        _write(_error(None, -32600, "Invalid JSON-RPC request"))
        return
    try:
        response = asyncio.run(dispatch(request))
    except Exception as exc:
        response = _error(request.get("id"), -32603, str(exc))
    if response is not None:
        _write(response)


def main() -> None:
    # Never print diagnostics to stdout; OpenCode expects only newline-delimited
    # JSON-RPC messages on this stream.
    for line in sys.stdin:
        if line.strip():
            _process_line(line)


if __name__ == "__main__":
    main()
