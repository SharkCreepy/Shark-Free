// SPDX-License-Identifier: GPL-3.0-or-later
// HuggingChat selectors for the shared simple-chat adapter.
// Message role markers and the stop label were found in the public app bundle.
// eslint-disable-next-line no-unused-vars
const ZSProvider = ZSSimpleChat.create({
  id: "huggingchat",
  displayName: "HuggingChat",
  // Fallback catalog labels; the live HuggingChat picker can change by account/rollout.
  portalModels: [
    { id: "hf-meta-llama-3-3-70b-instruct", name: "Meta Llama 3.3 70B Instruct" },
    { id: "hf-meta-llama-3-2-90b-vision-instruct", name: "Meta Llama 3.2 90B Vision Instruct" },
    { id: "hf-mistral-large-4-preview", name: "Mistral Large 4 Preview" },
    { id: "hf-mistral-small-3-1-24b-instruct", name: "Mistral Small 3.1 24B Instruct" },
    { id: "hf-mistral-nemo-12b-instruct", name: "Mistral NeMo 12B Instruct" },
  ],
  selectors: {
    userItem: '[data-message-type="user"], [data-testid*="user-message"], [data-role="user"]',
    assistantItem: '[data-message-role="assistant"], [data-testid*="assistant-message"], [data-role="assistant"]',
    anyItem: '[data-message-type="user"], [data-testid*="user-message"], [data-role="user"], [data-message-role="assistant"], [data-testid*="assistant-message"], [data-role="assistant"]',
    editor: 'textarea[placeholder="Ask anything"][role="combobox"]',
    composer: 'div.relative:has(> textarea[placeholder="Ask anything"][role="combobox"])',
    send: 'button[aria-label="Send message"]',
    stop: 'button[aria-label="Stop generating"]',
    error: '[role="alert"]',
  },
  conversationKey: () => {
    const match = (window.location && window.location.pathname || "").match(/^\/chat\/([^/?#]+)/);
    return match ? match[1] : "";
  },
});
