/**
 * Content script for chatgpt.com (and the legacy chat.openai.com mirror).
 *
 * ChatGPT renders each turn in a `div` carrying
 * `data-message-author-role="assistant"`. Multiple message bubbles can live
 * inside it for streaming + tool calls; we concatenate their text.
 */

import { attachAdapter, type PlatformAdapter } from "./shared";

const chatgptAdapter: PlatformAdapter = {
  name: "ChatGPT",
  assistantMessageSelector: "div[data-message-author-role='assistant']",

  extractText(messageEl: Element): string | null {
    // Prefer the most specific text containers — markdown blocks, code blocks,
    // and prose paragraphs. Fall back to overall innerText.
    const proseEls = messageEl.querySelectorAll<HTMLElement>(
      ".markdown, .prose, [data-message-id] p, [data-message-id] li, " +
        "[data-message-id] pre, [data-message-id] code",
    );
    if (proseEls.length === 0) {
      const text = (messageEl as HTMLElement).innerText?.trim() ?? null;
      return text && text.length > 0 ? text : null;
    }
    const parts: string[] = [];
    proseEls.forEach((el) => {
      const t = el.innerText?.trim();
      if (t && t.length > 0) parts.push(t);
    });
    const joined = parts.join("\n").trim();
    return joined.length > 0 ? joined : null;
  },

  extractContext(messageEl: Element): string | null {
    // Find the preceding user message for context
    const article = messageEl.closest("article");
    if (!article) return "ChatGPT response";
    const prev = article.previousElementSibling;
    const userMessage = prev?.querySelector(
      "div[data-message-author-role='user']",
    );
    const userText = (userMessage as HTMLElement | null)?.innerText?.trim();
    if (userText && userText.length > 0 && userText.length < 500) {
      return `ChatGPT response to: "${userText.slice(0, 200)}"`;
    }
    return "ChatGPT response";
  },
};

attachAdapter(chatgptAdapter);
