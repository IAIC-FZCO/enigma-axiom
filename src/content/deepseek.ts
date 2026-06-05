/**
 * Content script for chat.deepseek.com.
 *
 * DeepSeek's web client renders messages in `.ds-message` blocks with role
 * indicators on the parent container.
 */

import { attachAdapter, type PlatformAdapter } from "./shared";

const deepseekAdapter: PlatformAdapter = {
  name: "DeepSeek",
  // Matches assistant message bubble — combine multiple potential selectors
  // since DeepSeek's UI iterates quickly
  assistantMessageSelector:
    "div.ds-message.ds-message--assistant, " +
    "div[data-role='assistant'] .ds-markdown, " +
    "div.message-content[data-author='assistant']",

  extractText(messageEl: Element): string | null {
    const proseEls = messageEl.querySelectorAll<HTMLElement>(
      ".ds-markdown, .markdown-body, p, li, pre, code",
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
    return "DeepSeek response";
  },
};

attachAdapter(deepseekAdapter);
