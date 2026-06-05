/**
 * Content script for gemini.google.com.
 *
 * Gemini wraps each model response in a `<model-response>` custom element
 * (or `<message-content>` in the legacy Bard layout). The response body
 * is inside `.markdown` or `.model-response-text`.
 */

import { attachAdapter, type PlatformAdapter } from "./shared";

const geminiAdapter: PlatformAdapter = {
  name: "Gemini",
  // Cover both the new (post-rebrand) and legacy DOM
  assistantMessageSelector:
    "model-response, message-content, " +
    "div[data-test-id='model-response-message-content'], " +
    "div.model-response-text",

  extractText(messageEl: Element): string | null {
    const proseEls = messageEl.querySelectorAll<HTMLElement>(
      ".markdown, .response-content, .model-response-text, p, li, pre, code",
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

  extractContext(_messageEl: Element): string | null {
    // Gemini's DOM is harder to walk back through cleanly; just signal platform
    return "Gemini response";
  },
};

attachAdapter(geminiAdapter);
