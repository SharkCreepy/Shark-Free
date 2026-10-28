// SPDX-License-Identifier: GPL-3.0-or-later
// Duck.ai site selectors for the shared simple-chat adapter.
// The user and assistant markers are semantic test IDs/attributes from the live UI.
// eslint-disable-next-line no-unused-vars
const ZSProvider = ZSSimpleChat.create({
  id: "duck",
  displayName: "Duck.ai",
  selectors: {
    userItem: '[data-testid="user-message"]',
    assistantItem: '[data-activeresponse], [data-testid*="assistant-message"], [role="assistant"]',
    anyItem: '[data-testid="user-message"], [data-activeresponse], [data-testid*="assistant-message"], [role="assistant"]',
    reply: null,
    editor: 'textarea[name="user-prompt"], textarea[aria-label*="Ask" i]',
    composer: '[data-testid="duckai-chat-input"]',
    send: 'button[aria-label="Ask"], button[aria-label*="Ask" i]',
    stop: 'button[aria-label*="Stop generating" i], button[aria-label*="Stop response" i]',
    error: '[data-testid="UsageLimitBanner"], [data-testid*="error" i], [role="alert"]',
  },
  conversationKey: () => {
    const match = (window.location && window.location.pathname || "").match(/^\/chat\/([^/?#]+)/);
    return match ? match[1] : "";
  },
});
