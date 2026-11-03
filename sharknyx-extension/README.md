# SharkNyx Free - AI Roblox Studio Agent

Control Roblox Studio with AI, for free. SharkNyx turns a normal AI chat into an agent that builds and scripts your Roblox game: it can read and edit scripts, run Luau, inspect the game tree, and generate assets in Studio. Choose **Agent** to work in Studio or **Plan** for a plan without running commands. Supported chat sites are ChatGPT, Gemini, Kimi, GLM, Qwen, Arena, Meta AI, Ptero.pro, [Claude](https://claude.ai/new), [Duck.ai](https://duck.ai/), [Groq Chat](https://console.groq.com/chat), [Perplexity](https://www.perplexity.ai/), and [HuggingChat](https://huggingface.co/chat/).

It's a Chrome/Edge browser extension plus a small local bridge that connects chat to Roblox Studio through the official MCP server. No API key, terminal, or coding is required. Claude can receive Studio screenshots from SharkNyx. Every `multi_edit` script change is paused for review: inspect the before/after code, then **Accept**, **Decline**, or choose **Change…** to send revision instructions. Only Accept runs the edit. Prompts and final replies are kept concise to reduce unnecessary token use. ChatGPT may summarize its context in long sessions, so SharkNyx periodically restates its operating instructions. On Arena, keep the mode dropdown on **Direct**; SharkNyx supports Direct mode only.

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
5. Open a supported chat site: [ChatGPT](https://chatgpt.com/), [Gemini](https://gemini.google.com/), [Kimi](https://www.kimi.ai/), [GLM](https://chat.z.ai/), [Qwen](https://chat.qwen.ai/), [Arena](https://arena.ai/text/direct), [Meta AI](https://www.meta.ai/), [Ptero.pro](https://ptero.pro/), [Claude](https://claude.ai/new), [Duck.ai](https://duck.ai/), [Groq Chat](https://console.groq.com/chat), [Perplexity](https://www.perplexity.ai/), or [HuggingChat](https://huggingface.co/chat/). Sign in if the site asks, then start a new chat; on Arena, use Direct mode. Free-use limits vary. The SharkNyx menu also links to DeepSeek as a website recommendation, but DeepSeek is not currently integrated. See [AI_DIRECTORY_SOURCES.md](AI_DIRECTORY_SOURCES.md) for quota-label notes and [AI_PROVIDER_DOM_NOTES.md](AI_PROVIDER_DOM_NOTES.md) for the new adapter observations.
6. Choose **Agent** or **Plan** in the SharkNyx bar, then start the session. Agent mode requires the Bridge; Plan mode does not run Roblox commands.

[Watch the setup tutorial](https://youtu.be/kPKiZLZ9_Ps).

## Local SharkNyx Portal relay

The local Portal relay is extension version 1.2.7. It uses `portal-relay.js` on `http://127.0.0.1:3000` (or `http://localhost:3000`). Load this `sharknyx-extension` folder as an unpacked extension, then reload the extension and any already-open Portal/provider tabs. Start the Portal with its `start-portal.bat` launcher. Open provider sites using the Portal's **Provider sites** links, then sign in on the regular provider website. The Portal does not open login popups or monitor account status. The portal and extension never read, copy, store, or transmit passwords, cookies, or session tokens. A Portal send requires a matching provider tab that you already opened and visibly activates it before sending; the extension does not create background tabs. Portal conversation IDs remain local metadata; the provider page's current conversation is shared across Portal chats for that provider.

The Portal composer has separate **Chat** and **Roblox Agent** modes. Chat stays plain and never calls Studio tools. Agent mode requires live local-bridge and Studio MCP status, sends through the existing SharkNyx Agent loop and its current tool/script-review gates, and uses the already-open provider tab made visible by the user-initiated send. Because tool approval currently requires a visible page, Agent mode fails closed if the page remains hidden. The Portal shows extension, bridge, and Studio states separately, not provider-account login state. Kimi's K3.1 Pro, K2.8 Preview, and Instant choices are selected and confirmed through its visible model menu before a prompt is sent. HuggingChat Llama/Mistral and GLM-4/GLM-4V options are fallbacks; provider availability and page-side application still require confirmation, and Claude effort remains unmapped. Images are accepted only by adapters currently marked vision-capable and checked for canonical Base64 and matching image signatures. A live signed-in browser/provider roundtrip remains unverified.

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
providers/claude.js  Claude adapter
providers/simple-chat.js shared chat DOM and send logic
providers/duck.js    Duck.ai selectors
providers/groq.js    Groq Chat selectors
providers/perplexity.js Perplexity selectors
providers/huggingchat.js HuggingChat selectors
background.js         WebSocket connection to the local bridge
portal-relay.js       origin-checked localhost Portal message relay
```

`core/main.js` calls the common `ZSProvider` interface rather than reaching into each site's DOM. A provider integration consists of a site adapter plus its host and content-script entries in `manifest.json`, the bridge and popup host lists, and the site shortcut list in `core/main.js`.

Run the dependency-free smoke tests from this folder:

- `node test-parser.js` — command parser.
- `node test-modes.js` — Agent/Plan prompt separation and safety marker.
- `node test-chatgpt.js` — ChatGPT reply-reading behavior.
- `node test-gemini-long-session.js` — Gemini's periodic long-session instruction refresh.
- `node test-ptero.js` — Ptero message reading and chat identity.
- `node test-claude.js` — Claude message reading, streaming, screenshot upload, and ProseMirror sending.
- `node test-simple-providers.js` — Duck.ai, Groq, Perplexity, and HuggingChat selector and send behavior.
- `node test-edit-review.js` — script-edit preview data, raw fallback, and approval-policy prompts.
- `node test-portal-relay.js` — loopback-origin checks, PING/SEND forwarding, session/tool isolation guards, and Base64/image-signature validation.
- `node test-portal-cancellation.js` — cancellation, existing provider-tab activation, missing-tab behavior, sign-in failure handling, and Agent visibility gates.
- `node test-portal-auth-flow.js` — no-login-popup/no-background-tab guarantees, send-time page readiness, and the no-cookie boundary.
- `node test-kimi-model-selection.js` — exact Kimi dropdown option selection and visible-selection confirmation.
- `node test-portal-images.js` — provider-page validation for canonical Base64, actual image signatures, MIME/size mismatches, and count limits.

## Support

[Ko-fi](https://ko-fi.com/sebattfg) — Robux tip passes are also available in the extension panel.


### Groq request-size / TPM errors

Groq may reject a large accumulated request with `Request too large for model` and a per-minute token allowance. The Portal displays the provider's requested/allowed counts when available and will not silently trim or automatically resend the prompt. Shorten the prompt or provider-side conversation history, switch models, or start a fresh Groq conversation; a Portal-only New chat does not reset Groq's page history. Regression: `node test-groq-tpm-error.js`.
