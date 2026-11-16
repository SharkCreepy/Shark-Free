import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mcp = load_module("sharknyx_opencode_mcp", ROOT / "sharknyx_opencode_mcp.py")
installer = load_module("install_opencode_mcp", ROOT / "install_opencode_mcp.py")


class FakeBridge:
    def __init__(self):
        self.calls = []
        self.server = None
        self.url = None

    async def __aenter__(self):
        async def handle(ws, path=None):
            await ws.send(json.dumps({"type": "connected", "mcp_alive": True}))
            async for raw in ws:
                req = json.loads(raw)
                self.calls.append(req)
                if req["type"] == "list_tools":
                    await ws.send(json.dumps({
                        "type": "tools", "id": req["id"],
                        "tools": [{
                            "name": "get_studio_state",
                            "description": "Read the current Roblox Studio state.",
                            "inputSchema": {"type": "object", "properties": {}},
                            "server": "roblox",
                        }],
                    }))
                elif req["type"] == "call_tool":
                    await ws.send(json.dumps({
                        "type": "tool_result", "id": req["id"], "ok": True,
                        "text": "Studio is connected", "images": [
                            {"data": "aW1hZ2U=", "mimeType": "image/png"}
                        ],
                    }))
        self.server = await websockets.serve(handle, "127.0.0.1", 0)
        port = self.server.sockets[0].getsockname()[1]
        self.url = f"ws://127.0.0.1:{port}"
        mcp.BRIDGE_URL = self.url
        return self

    async def __aexit__(self, exc_type, exc, tb):
        self.server.close()
        await self.server.wait_closed()


class NativeMCPTests(unittest.IsolatedAsyncioTestCase):
    async def test_initialize_handshake(self):
        result = await mcp.dispatch({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26"},
        })
        self.assertEqual(result["result"]["protocolVersion"], "2025-03-26")
        self.assertEqual(result["result"]["serverInfo"]["name"], "sharknyx-roblox-bridge")
        self.assertIn("tools", result["result"]["capabilities"])

    async def test_bridge_tools_are_exposed_without_private_fields(self):
        async with FakeBridge():
            result = await mcp.dispatch({"jsonrpc": "2.0", "id": "l", "method": "tools/list"})
        tool = result["result"]["tools"][0]
        self.assertEqual(tool["name"], "get_studio_state")
        self.assertIn("inputSchema", tool)
        self.assertNotIn("server", tool)

    async def test_tool_result_preserves_text_and_image_content(self):
        async with FakeBridge():
            result = await mcp.dispatch({
                "jsonrpc": "2.0", "id": "c", "method": "tools/call",
                "params": {"name": "get_studio_state", "arguments": {}},
            })
        content = result["result"]["content"]
        self.assertEqual(content[0], {"type": "text", "text": "Studio is connected"})
        self.assertEqual(content[1]["mimeType"], "image/png")
        self.assertFalse(result["result"]["isError"])

    async def test_bridge_failure_becomes_mcp_tool_error(self):
        mcp.BRIDGE_URL = "ws://127.0.0.1:1"
        result = await mcp.dispatch({
            "jsonrpc": "2.0", "id": "c", "method": "tools/call",
            "params": {"name": "get_studio_state", "arguments": {}},
        })
        self.assertTrue(result["result"]["isError"])
        self.assertIn("Run start.bat", result["result"]["content"][0]["text"])


class OpenCodeConfigTests(unittest.TestCase):
    def test_install_merges_jsonc_and_remove_preserves_other_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "opencode.json"
            path.write_text('''{
              // Keep pre-existing model selection.
              "model": "provider/model",
              "mcp": { "servers": { "existing": { "type": "remote", "url": "https://example.test/mcp", }, }, },
            }''', encoding="utf-8")
            self.assertTrue(installer.install(path))
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(data["model"], "provider/model")
            self.assertIn("existing", data["mcp"]["servers"])
            added = data["mcp"]["servers"]["sharknyx-roblox"]
            self.assertFalse(added["codemode"])
            self.assertEqual(added["command"][1], str(ROOT / "sharknyx_opencode_mcp.py"))
            self.assertTrue(path.with_suffix(".json.bak").exists())
            self.assertTrue(installer.remove(path))
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(data["mcp"]["servers"]), {"existing"})
            self.assertEqual(data["model"], "provider/model")

    def test_install_preserves_direct_mcp_layout(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "opencode.json"
            path.write_text(json.dumps({"mcp": {
                "existing": {"type": "remote", "url": "https://example.test/mcp", "enabled": True}
            }}), encoding="utf-8")
            self.assertTrue(installer.install(path))
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertIn("existing", data["mcp"])
            self.assertIn("sharknyx-roblox", data["mcp"])
            self.assertEqual(data["mcp"]["existing"]["url"], "https://example.test/mcp")
            self.assertTrue(installer.remove(path))
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(data["mcp"]), {"existing"})

    def test_notifications_do_not_get_responses(self):
        self.assertIsNone(asyncio.run(mcp.dispatch({
            "jsonrpc": "2.0", "method": "notifications/initialized",
        })))


if __name__ == "__main__":
    unittest.main(verbosity=2)
