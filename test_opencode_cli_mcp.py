"""OpenCode config discovery and stdio transport smoke tests."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent
OPENCODE = os.environ.get("OPENCODE_BIN", "opencode")


class NativeOpenCodeIntegrationTests(unittest.TestCase):
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
            result = asyncio.run(self._run_cli(
                [OPENCODE, "debug", "config", "--standalone"], env=env, cwd=ROOT))
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertIn(str(config_path), result.stdout)
            self.assertIn("sharknyx-roblox", result.stdout)

    def test_native_stdio_server_lists_and_calls_bridge_tools(self):
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
