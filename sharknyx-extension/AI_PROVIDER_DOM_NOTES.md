# Provider DOM notes

These selectors were inspected on 2026-10-29 in the public web apps without submitting a chat message. Pages may change; recheck before changing the adapters.

## Supported provider entry points

The current SharkNyx provider catalog uses these entry URLs. This registry is not a claim that every provider's page DOM has been freshly inspected or that every account can use every feature.

- **ChatGPT:** https://chatgpt.com/
- **Claude:** https://claude.ai/new
- **Gemini:** https://gemini.google.com/app
- **Groq:** https://console.groq.com/chat
- **Duck.ai:** https://duck.ai/
- **Perplexity:** https://www.perplexity.ai/
- **HuggingChat:** https://huggingface.co/chat/
- **Kimi:** https://www.kimi.com/
- **GLM / Z.ai:** https://chat.z.ai/
- **Qwen:** https://chat.qwen.ai/
- **Arena:** https://arena.ai/
- **Meta AI:** https://www.meta.ai/
- **Ptero:** https://ptero.pro/
- **OpenCode (local web UI):** http://127.0.0.1:4096/ — the real port is printed by `opencode service status` (49374 on macOS/Linux/WSL, 28894 on Windows).

DeepSeek is not in the current supported provider list.

## Perplexity

- Page: [https://www.perplexity.ai/](https://www.perplexity.ai/)
- The landing page exposes a contenteditable Lexical editor: `#ask-input[contenteditable="true"][role="textbox"][data-lexical-editor="true"]`. Its visible composer wrapper includes `.bg-composer`.
- The empty composer does not expose its submit control. After temporarily inserting local probe text and restoring the editor without submitting, a button appeared with `aria-label="Submit"`; use this state-dependent marker, not the voice-mode button.
- The inspected landing page had no conversation turns. User/assistant message selectors and streaming/stop states remain unverified and should use resilient fallbacks until tested in an actual chat.

## HuggingChat

- Page: [https://huggingface.co/chat/](https://huggingface.co/chat/)
- The landing page exposes `textarea[placeholder="Ask anything"][role="combobox"]`, a visible `button[aria-label="Send message"]`, and a welcome view under `[aria-label="Conversation messages"]`. A sign-in gate was not visible during inspection; actual message acceptance was not tested.
- The public client chunk [DmiFVLYs.js](https://huggingface.co/chat/_app/immutable/chunks/DmiFVLYs.js) contains assistant markup with `data-message-role="assistant"`, a user-message selector `[data-message-type="user"]`, stable `data-message-id` attributes, and a stop control labeled `Stop generating`. The initial blank landing page had no rendered turns, so these selectors are grounded in the loaded component bundle rather than a sent conversation.

## OpenCode

- Page: the web UI shipped with the OpenCode server (`opencode serve`, `opencode pair`), normally `http://127.0.0.1:<port>`.
- Inspected on 2026-11-16 against OpenCode 2.3.0 with a locally served instance: pairing screen, password sign-in, project selection, and a live free-model turn.
- The page is a single-page app whose shell always ships `<title>OpenCode</title>` and sets `data-theme="oc-2"` on `<html>`. Those two markers are the adapter's activation test, because `http://127.0.0.1/*` content scripts also match every other local app.
- Messages are timeline rows: `[data-timeline-row="UserMessage"]` (prompt text in `[data-slot="user-message-text"]`) and `[data-timeline-row="AssistantPart"]`. One assistant message is split across several parts — reasoning, text, tools — that share the same `data-message-id`, so reply text must be gathered per message id rather than per row.
- Assistant prose lives in `[data-component="text-part"] [data-slot="text-part-body"]`. The `Build · <model> · <time> · <tok/s>` footer is a sibling `[data-slot="text-part-copy-wrapper"]` and is excluded from the reply.
- The composer is a `div[contenteditable="true"][role="textbox"]`; `button[data-action="composer-submit"]` is the Send control and the *same* button becomes `aria-label="Stop"` while a turn runs. `[data-slot="user-message-pending"]` remains in the DOM after generation ends and is not a live busy signal.
- Session identity comes from `/server/<base64>/session/<id>`; an unsent draft uses `/new-session?draftId=<uuid>`.
- The UI is project-scoped: a session only exists after a project folder is added, and that choice lives in the browser's local storage rather than the server.

For the installed OpenCode desktop app or CLI, use the native MCP adapter in the repository root (`sharknyx_opencode_mcp.py`), not this browser DOM provider. On Windows, `start.bat` registers the native server in OpenCode's global config before it starts the Roblox bridge; the Chrome extension is not required for that path.
