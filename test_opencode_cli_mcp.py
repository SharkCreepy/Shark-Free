"""OpenCode config discovery and loopback MCP transport smoke tests."""
import asyncio
import json
import os
import shutil
import socket
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent
OPENCODE = os.environ.get("OPENCODE_BIN", "opencode")


class NativeOpenCodeIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which(OPENCODE), "OpenCode CLI is not installed")
    def test_opencode_loads_the_global_sharknyx_mcp_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            config_dir = home / ".config" / "opencode"
            config_dir.mkdir(parents=True)
            config_path = config_dir / "opencode.json"
            env = os.environ.copy()
            env["HOME"] = str(home)
            env["USERPROFILE"] = str(home)
            env.pop("XDG_CONFIG_HOME", None)
            env["OPENCODE_DISABLE_AUTOUPDATE"] = "1"
            install = asyncio.run(self._run_cli(
                [sys.executable, str(ROOT / "install_opencode_mcp.py")], env=env, cwd=ROOT))
            self.assertEqual(install.returncode, 0, install.stdout)
            self.assertTrue(config_path.is_file())
            data = json.loads(config_path.read_text(encoding="utf-8"))
            server = data["mcp"]["servers"]["sharknyx-roblox"]
            self.assertEqual(server["type"], "remote")
            self.assertEqual(server["url"], "http://127.0.0.1:17614/mcp")
            self.assertFalse(server["oauth"])
            result = asyncio.run(self._run_cli(
                [OPENCODE, "debug", "config", "--standalone"], env=env, cwd=ROOT))
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertIn(str(config_path), result.stdout)
            self.assertIn("sharknyx-roblox", result.stdout)

    @unittest.skipUnless(shutil.which(OPENCODE), "OpenCode CLI is not installed")
    def test_opencode_cli_connects_to_remote_http_bridge(self):
        async def scenario():
            bridge_requests = []

            async def fake_bridge(ws, path=None):
                await ws.send(json.dumps({"type": "connected", "mcp_alive": True}))
                async for raw in ws:
                    request = json.loads(raw)
                    bridge_requests.append(request)
                    if request.get("type") == "list_tools":
                        await ws.send(json.dumps({
                            "type": "tools", "id": request["id"],
                            "tools": [{
                                "name": "get_studio_state",
                                "description": "Read Roblox Studio state.",
                                "inputSchema": {"type": "object", "properties": {}},
                            }],
                        }))
                    elif request.get("type") == "call_tool":
                        await ws.send(json.dumps({
                            "type": "tool_result", "id": request["id"], "ok": True,
                            "text": "Roblox Studio is connected", "images": [
                                {"data": "aW1hZ2U=", "mimeType": "image/png"}
                            ],
                        }))

            bridge = await websockets.serve(fake_bridge, "127.0.0.1", 0)
            bridge_port = bridge.sockets[0].getsockname()[1]
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                http_port = probe.getsockname()[1]
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                opencode_port = probe.getsockname()[1]

            temp = tempfile.TemporaryDirectory()
            config_path = Path(temp.name) / "opencode.json"
            env = os.environ.copy()
            env["SHARKNYX_BRIDGE_URL"] = f"ws://127.0.0.1:{bridge_port}"
            env["ZS_OPENCODE_MCP_PORT"] = str(http_port)
            http_proc = await asyncio.create_subprocess_exec(
                sys.executable, str(ROOT / "sharknyx_opencode_http.py"),
                cwd=str(ROOT), env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            opencode_proc = None
            try:
                health_url = f"http://127.0.0.1:{http_port}/health"

                def wait_for_http():
                    import time
                    for _ in range(50):
                        try:
                            with urllib.request.urlopen(health_url, timeout=0.3) as response:
                                if response.status == 200:
                                    return True
                        except Exception:
                            time.sleep(0.1)
                    return False

                self.assertTrue(await asyncio.to_thread(wait_for_http), "HTTP MCP endpoint did not start")

                def post_rpc(payload):
                    request = urllib.request.Request(
                        f"http://127.0.0.1:{http_port}/mcp",
                        data=json.dumps(payload).encode("utf-8"),
                        headers={
                            "Content-Type": "application/json",
                            "Accept": "application/json, text/event-stream",
                        },
                        method="POST",
                    )
                    with urllib.request.urlopen(request, timeout=15) as response:
                        raw = response.read()
                        return response.status, json.loads(raw) if raw else None

                status, init = await asyncio.to_thread(post_rpc, {
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {"protocolVersion": "2025-03-26"},
                })
                self.assertEqual(status, 200)
                self.assertEqual(init["result"]["serverInfo"]["name"], "sharknyx-roblox-bridge")
                status, tools = await asyncio.to_thread(post_rpc, {
                    "jsonrpc": "2.0", "id": 2, "method": "tools/list",
                })
                self.assertEqual(status, 200)
                self.assertEqual(tools["result"]["tools"][0]["name"], "get_studio_state")
                status, call = await asyncio.to_thread(post_rpc, {
                    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": {"name": "get_studio_state", "arguments": {}},
                })
                self.assertEqual(status, 200)
                self.assertEqual(call["result"]["content"][0]["text"], "Roblox Studio is connected")
                self.assertEqual(call["result"]["content"][1]["mimeType"], "image/png")

                config_path.write_text(json.dumps({
                    "mcp": {"servers": {"sharknyx-roblox": {
                        "type": "remote",
                        "url": f"http://127.0.0.1:{http_port}/mcp",
                        "oauth": False,
                        "timeout": 180000,
                        "codemode": False,
                    }}}
                }), encoding="utf-8")
                env["OPENCODE_CONFIG"] = str(config_path)
                env["OPENCODE_PASSWORD"] = "native-mcp-test"
                env["OPENCODE_DISABLE_AUTOUPDATE"] = "1"
                opencode_proc = await asyncio.create_subprocess_exec(
                    OPENCODE, "serve", "--hostname", "127.0.0.1", "--port", str(opencode_port),
                    cwd=str(ROOT), env=env,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                ready = False
                for _ in range(60):
                    await asyncio.sleep(0.2)
                    with socket.socket() as probe:
                        ready = probe.connect_ex(("127.0.0.1", opencode_port)) == 0
                    if ready:
                        break
                if not ready:
                    raise AssertionError("OpenCode serve did not start")

                output = ""
                for _ in range(8):
                    result = await self._run_cli(
                        [OPENCODE, "mcp", "list", "--server", f"http://127.0.0.1:{opencode_port}"],
                        env=env, cwd=ROOT,
                    )
                    output = result.stdout
                    if "sharknyx-roblox" in output and "connected" in output.lower():
                        break
                    await asyncio.sleep(1)
                return output, bridge_requests
            finally:
                if opencode_proc and opencode_proc.returncode is None:
                    opencode_proc.terminate()
                    await asyncio.wait_for(opencode_proc.communicate(), timeout=10)
                if http_proc.returncode is None:
                    http_proc.terminate()
                    await asyncio.wait_for(http_proc.communicate(), timeout=10)
                temp.cleanup()
                bridge.close()
                await bridge.wait_closed()

        output, bridge_requests = asyncio.run(scenario())
        self.assertIn("sharknyx-roblox", output)
        self.assertIn("connected", output.lower())
        self.assertTrue(any(item.get("type") == "list_tools" for item in bridge_requests))

    def test_native_stdio_adapter_remains_available_for_cli_fallbacks(self):
        async def scenario():
            async def fake_bridge(ws, path=None):
                await ws.send(json.dumps({"type": "connected", "mcp_alive": True}))
                async for raw in ws:
                    req = json.loads(raw)
                    if req.get("type") == "list_tools":
                        await ws.send(json.dumps({
                            "type": "tools", "id": req["id"],
                            "tools": [{
                                "name": "get_studio_state",
                                "description": "Read Roblox Studio state.",
                                "inputSchema": {"type": "object", "properties": {}},
                                "server": "roblox",
                            }],
                        }))
                    elif req.get("type") == "call_tool":
                        await ws.send(json.dumps({
                            "type": "tool_result", "id": req["id"], "ok": True,
                            "text": "Roblox Studio is connected", "images": [],
                        }))

            server = await websockets.serve(fake_bridge, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            env = os.environ.copy()
            env["SHARKNYX_BRIDGE_URL"] = f"ws://127.0.0.1:{port}"
            proc = await asyncio.create_subprocess_exec(
                os.environ.get("PYTHON", "python3"), str(ROOT / "sharknyx_opencode_mcp.py"),
                cwd=str(ROOT), env=env,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                inputs = [
                    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_studio_state", "arguments": {}}},
                ]
                proc.stdin.write(("\n".join(json.dumps(x) for x in inputs) + "\n").encode())
                await proc.stdin.drain()
                proc.stdin.close()
                responses = []
                for _ in range(3):
                    raw = await asyncio.wait_for(proc.stdout.readline(), timeout=10)
                    responses.append(json.loads(raw))
                await asyncio.wait_for(proc.wait(), timeout=10)
                return proc.returncode, responses
            finally:
                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()
                server.close()
                await server.wait_closed()

        code, responses = asyncio.run(scenario())
        self.assertEqual(code, 0)
        self.assertEqual(responses[0]["result"]["serverInfo"]["name"], "sharknyx-roblox-bridge")
        self.assertEqual(responses[1]["result"]["tools"][0]["name"], "get_studio_state")
        self.assertEqual(responses[2]["result"]["content"][0]["text"], "Roblox Studio is connected")

    @staticmethod
    async def _run_cli(args, env, cwd):
        proc = await asyncio.create_subprocess_exec(
            *args, cwd=str(cwd), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        output, _ = await asyncio.wait_for(proc.communicate(), timeout=45)
        return type("Result", (), {
            "returncode": proc.returncode,
            "stdout": output.decode("utf-8", errors="replace"),
        })()


if __name__ == "__main__":
    unittest.main(verbosity=2)
