// SPDX-License-Identifier: GPL-3.0-or-later
// Perplexity selectors for the shared simple-chat adapter.
// Composer/send controls were inspected live; message role selectors are resilient
// fallbacks because no message was submitted during the public-page inspection.
// eslint-disable-next-line no-unused-vars
const ZSProvider = ZSSimpleChat.create({
  id: "perplexity",
  displayName: "Perplexity",
  selectors: {
    userItem: '[data-testid*="user-query"], [data-testid*="user-message"], [data-testid="question"], [data-message-role="user"], [data-role="user"], [data-author="user"]',
    assistantItem: '[data-testid*="answer"], [data-testid*="assistant-message"], [data-message-role="assistant"], [data-role="assistant"], [data-author="assistant"], [data-message-author="assistant"]',
    anyItem: '[data-testid*="user-query"], [data-testid*="user-message"], [data-testid="question"], [data-message-role="user"], [data-role="user"], [data-author="user"], [data-testid*="answer"], [data-testid*="assistant-message"], [data-message-role="assistant"], [data-role="assistant"], [data-author="assistant"], [data-message-author="assistant"]',
    editor: '#ask-input[contenteditable="true"][role="textbox"]',
    composer: '.bg-composer:has(#ask-input[contenteditable="true"])',
    send: 'button[aria-label="Submit"]',
    stop: 'button[aria-label*="Stop" i], button[title*="Stop" i]',
    error: '[role="alert"], [data-testid*="error" i]',
  },
  conversationKey: () => {
    const path = window.location && window.location.pathname || "";
    const match = path.match(/^\/(?:search|thread)\/([^/?#]+)/);
    return match ? match[1] : "";
  },
});
