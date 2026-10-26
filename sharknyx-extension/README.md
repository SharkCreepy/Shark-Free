# SharkNyx Free - AI Roblox Studio Agent

Control Roblox Studio with AI, for free. SharkNyx turns a normal AI chat into an agent that builds and scripts your Roblox game for you: describe what you want, and it can read and edit scripts, run Luau, inspect the game tree, and generate assets directly in Roblox Studio. Choose **Agent** to let it work in Studio, or **Plan** to get a plan without running commands. Supported chat sites are ChatGPT, Google Gemini, Kimi, GLM, Qwen, Arena, Meta AI, Ptero.pro, [Claude](https://claude.ai/new), and [Viro](https://ai.viro.app/chat).

It's a Chrome/Edge browser extension plus a small local bridge that connects the chat to Roblox Studio through the official MCP server. No API key, terminal, or coding is required. ChatGPT screenshots and image input are disabled because its free tier caps file/image input separately from messages. ChatGPT also summarizes its own context in long sessions, so SharkNyx periodically restates its operating instructions. On Arena, keep the mode dropdown on **Direct**; SharkNyx supports Direct mode only.

## Setup

**Load the extension manually (Edge or Chrome):**

1. Go to `edge://extensions` (Edge) or `chrome://extensions` (Chrome).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `sharknyx-extension` folder.
4. The extension is now active.

**Then set up the Bridge:**

1. Download the Bridge from the [GitHub releases page](https://github.com/SharkCreepy/Shark-Free).
2. Open Roblox Studio and load a Place.
3. Enable the MCP server in Roblox Studio: **Assistant AI** > **...** > **Manage MCP Servers** > **Enable Studio as MCP Server**.
4. Run `start.bat` (Windows) or `MacOS_Start.command` (macOS). On macOS, if Gatekeeper blocks the first launch, open **System Settings > Privacy & Security** and allow it.
5. Open a supported chat site: [ChatGPT](https://chatgpt.com/), [Gemini](https://gemini.google.com/), [Kimi](https://www.kimi.ai/), [GLM](https://chat.z.ai/), [Qwen](https://chat.qwen.ai/), [Arena](https://arena.ai/text/direct), [Meta AI](https://www.meta.ai/), [Ptero.pro](https://ptero.pro/), [Claude](https://claude.ai/new), or [Viro](https://ai.viro.app/chat). Sign in to Viro if prompted. Start a new chat; on Arena, use Direct mode.
6. Choose **Agent** or **Plan** in the SharkNyx bar, then start the session. Agent mode requires the Bridge; Plan mode does not run Roblox commands.

[Watch the setup tutorial](https://youtu.be/kPKiZLZ9_Ps).

## Architecture

The extension uses a provider-agnostic core and one provider adapter per AI chat site:

```text
core/config.js        system prompt, feedback strings, tool categories
core/parser.js        SharkNyx command parsing
core/main.js          agent loop, UI, camouflage, session state
providers/chatgpt.js  ChatGPT adapter
providers/gemini.js   Gemini adapter
providers/kimi.js     Kimi adapter
providers/glm.js      GLM / Z.ai adapter
providers/qwen.js     Qwen adapter
providers/arena.js    Arena adapter
providers/meta.js     Meta AI adapter
providers/ptero.js    Ptero.pro adapter
providers/claude.js   Claude adapter
providers/viro.js     Viro adapter
background.js         WebSocket connection to the local bridge
```

`core/main.js` calls the common `ZSProvider` interface rather than reaching into each site's DOM. A provider integration consists of a site adapter plus its host and content-script entries in `manifest.json`, the bridge and popup host lists, and the site shortcut list in `core/main.js`.

Run the dependency-free smoke tests from this folder:

- `node test-parser.js` — command parser.
- `node test-modes.js` — Agent/Plan prompt separation and safety marker.
- `node test-chatgpt.js` — ChatGPT reply-reading behavior.
- `node test-gemini-long-session.js` — Gemini's periodic long-session instruction refresh.
- `node test-ptero.js` — Ptero message reading and chat identity.
- `node test-claude.js` — Claude message reading, streaming, and ProseMirror sending.
- `node test-viro.js` — Viro message reading, chat identity, and textarea sending.

## Support

[Ko-fi](https://ko-fi.com/sebattfg) — Robux tip passes are also available in the extension panel.
