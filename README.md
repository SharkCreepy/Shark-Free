# SharkNyx Free

**SharkNyx Free v1.5.8** is an extension-focused release (extension manifest v1.2.8). Download `SharkNyx-Extension-v1.2.8.zip` from this GitHub release. It contains the unpacked Chrome/Edge extension folder; it is not a Portal or full installer ZIP. The previous v1.5.7 Full ZIP remains in its existing release unchanged.

## What's new

- Agent and Plan sessions can ask one focused question with two to four answer choices and a custom reply field.
- The Agent pauses on question-formatted replies and waits for your explicit answer before continuing; it will not execute commands from that question response.
- Refresh the extension popup and provider-page surfaces with a dark navy/white blue-gradient theme.
- Portal localhost routing and injection have been removed from the extension background worker and manifest. The Roblox Studio bridge and supported AI provider adapters remain.

## Install

1. Download and extract `SharkNyx-Extension-v1.2.8.zip`.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted `sharknyx-extension` folder.
4. Open a supported AI chat site. Sign in there if required, choose **Agent** or **Plan** from the SharkNyx bar, and start the session.
5. For Roblox Agent actions, start the local bridge with `start.bat` (Windows) or `MacOS_Start.command` (macOS) and enable Roblox Studio's MCP server.

The extension does not add a DeepSeek adapter or provider API-key integration. See [`CHANGELOG.md`](CHANGELOG.md) for full history.
