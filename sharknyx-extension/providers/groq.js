// SPDX-License-Identifier: GPL-3.0-or-later
// Selectors verified on https://console.groq.com/chat.
// User turns render as right-aligned group wrappers; assistant turns use the
// transition-all response wrapper. The composer is duplicated for responsive
// layouts, so the shared adapter chooses the visible instance.
// eslint-disable-next-line no-unused-vars
const ZSProvider = ZSSimpleChat.create({
  id: "groq",
  displayName: "Groq Chat",
  selectors: {
    userItem: 'div.w-full.flex.flex-col.items-end.group',
    assistantItem: 'div.group.relative[class*="transition-all"]',
    anyItem: 'div.w-full.flex.flex-col.items-end.group, div.group.relative[class*="transition-all"]',
    reply: null,
    editor: 'textarea[placeholder="Ask Groq"]',
    composer: 'div:has(> textarea[placeholder="Ask Groq"])',
    send: 'button:has(svg.lucide-arrow-up)',
    stop: 'button[aria-label*="Stop" i], button[title*="Stop" i]',
    error: '[role="alert"], [class*="error" i], [class*="limit" i]',
  },
  conversationKey: () => {
    const path = window.location && window.location.pathname || "";
    const match = path.match(/^\/(?:chat|c)\/([^/?#]+)/);
    return match ? match[1] : "";
  },
});
