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
