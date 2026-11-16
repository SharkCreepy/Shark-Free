#!/usr/bin/env python3
"""Expose SharkNyx as a loopback Streamable HTTP MCP server.

OpenCode Desktop on Windows has had failures with local stdio MCP processes.
This endpoint gives OpenCode a remote-transport URL on localhost while
forwarding tools/calls to the existing SharkNyx WebSocket bridge.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import sharknyx_opencode_mcp as adapter

HOST = "127.0.0.1"
PORT = int(os.environ.get("ZS_OPENCODE_MCP_PORT", "17614"))
MAX_BODY = adapter.MAX_MESSAGE


class MCPHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = "SharkNyxMCP/1.5.10"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        # Keep routine polling out of the console; the parent bridge captures
        # stderr to logs/opencode_http.log when it starts this helper.
        return

    def _send_json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_empty(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/health":
            self._send_json(200, {
                "ok": True,
                "service": "sharknyx-roblox-bridge",
                "transport": "streamable-http",
                "bridge": adapter.BRIDGE_URL,
            })
        elif path == "/mcp":
            # This stateless endpoint sends JSON responses to POST requests and
            # does not open server-initiated SSE streams.
            self.send_response(405)
            self.send_header("Allow", "POST")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/mcp":
            self._send_json(404, {"error": "Not found"})
            return
        if self.headers.get_content_type() != "application/json":
            self._send_json(415, {"error": "Content-Type must be application/json"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Invalid Content-Length"})
            return
        if size <= 0 or size > MAX_BODY:
            self._send_json(413 if size > MAX_BODY else 400, {"error": "Invalid request body size"})
            return
        try:
            request = json.loads(self.rfile.read(size).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send_json(400, {"error": f"Invalid JSON: {exc}"})
            return

        try:
            if isinstance(request, list):
                responses = []
                for item in request:
                    if isinstance(item, dict):
                        result = asyncio.run(adapter.dispatch(item))
                        if result is not None:
                            responses.append(result)
                if not responses:
                    self._send_empty(202)
                else:
                    self._send_json(200, responses)
                return
            if not isinstance(request, dict):
                self._send_json(400, {"error": "Invalid JSON-RPC request"})
                return
            response = asyncio.run(adapter.dispatch(request))
            if response is None:
                self._send_empty(202)
            else:
                self._send_json(200, response)
        except Exception as exc:
            request_id = request.get("id") if isinstance(request, dict) else None
            self._send_json(200, {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32603, "message": str(exc)},
            })


def create_server(host: str = HOST, port: int = PORT, bridge_url: str | None = None):
    """Create the HTTP server; bridge.py hosts it in a managed daemon thread."""
    if bridge_url:
        adapter.BRIDGE_URL = bridge_url
    return MCPHTTPServer((host, port), Handler)


def main() -> int:
    try:
        server = create_server()
    except OSError as exc:
        print(f"SharkNyx HTTP MCP could not bind to {HOST}:{PORT}: {exc}", file=sys.stderr, flush=True)
        return 1
    print(f"SharkNyx HTTP MCP listening at http://{HOST}:{PORT}/mcp", file=sys.stderr, flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
