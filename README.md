# SharkNyx Free

**SharkNyx Free v1.5.9** adds native MCP access from the installed OpenCode desktop app or CLI. Download `SharkNyx-Free-v1.5.9-Full.zip` from the GitHub release. It includes `start.bat`, the Roblox bridge, the browser extension (manifest v1.2.9), and the OpenCode MCP adapter.

## What's new

- Agent and Plan sessions can ask one focused question with two to four answer choices and a custom reply field.
- The Agent pauses on question-formatted replies and waits for your explicit answer before continuing; it will not execute commands from that question response.
- Refresh the extension popup and provider-page surfaces with a dark navy/white blue-gradient theme.
- Portal localhost routing and injection have been removed from the extension background worker and manifest. The Roblox Studio bridge and supported AI provider adapters remain.

## Install

1. Download and extract `SharkNyx-Free-v1.5.9-Full.zip`.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted `sharknyx-extension` folder.
4. Open a supported AI chat site. Sign in there if required, choose **Agent** or **Plan** from the SharkNyx bar, and start the session.
5. For Roblox Agent actions, start the local bridge with `start.bat` (Windows) or `MacOS_Start.command` (macOS) and enable Roblox Studio's MCP server.

The extension does not add a DeepSeek adapter or provider API-key integration. See [`CHANGELOG.md`](CHANGELOG.md) for full history.

## Use installed OpenCode (native MCP)

The installed OpenCode desktop app/CLI does not use the Chrome extension. Extract the full release ZIP and run `start.bat` (Windows) or `MacOS_Start.command` (macOS); the launcher automatically registers SharkNyx as a global OpenCode MCP server and starts the Roblox bridge. Then launch or restart OpenCode. Its native tools connect to the running bridge—no OpenCode browser UI or Portal is needed. Keep Roblox Studio open with its MCP server enabled. To remove the OpenCode registration, run `python install_opencode_mcp.py --remove` from the extracted folder.
