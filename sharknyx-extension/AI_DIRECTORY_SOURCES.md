# AI directory source notes

Usage notes reviewed 2026-10-28. Provider entry points below reflect the SharkNyx Portal catalog on 2026-10-29. URLs identify the configured website only; they do not guarantee account access, free quota, sign-in availability, or provider support for automated interaction.

## Current supported provider entry points

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

DeepSeek is intentionally excluded from the current supported provider list.

## Public usage-limit notes

These observations are not guarantees of current access, quota size, or availability; provider pages and plans can change.

- **Duck.ai:** DuckDuckGo says Duck.ai is free with a daily usage limit. Its help page says the free limit resets at midnight UTC. This is the only listed service whose official help page reviewed here states a daily chat limit. [Usage limits](https://duckduckgo.com/duckduckgo-help-pages/duckai/usage-limits)
- **Groq Chat:** The [Groq console chat](https://console.groq.com/chat) has an “Ask Groq” composer and a sign-in prompt. It does not publish a consumer web-chat quota on the page reviewed. GroqCloud's [API rate-limit documentation](https://console.groq.com/docs/rate-limits) covers API usage, not the Groq console chat; do not use those API limits as a web-chat quota.
- **Meta AI:** Meta's [official Meta AI page](https://www.meta.ai/) describes the assistant and its features but does not publish a chat quota on the page reviewed.

“Quota not listed” means that no public consumer chat limit was found on the official page reviewed; it does not imply unlimited use. The provider-specific model choices are recorded separately in the portal's `MODEL_DIRECTORY_SOURCES.md`.
