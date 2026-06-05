/**
 * Content script for claude.ai.
 *
 * Claude renders each assistant turn as a div whose role/content lives in
 * an aria-labelled container. The most reliable hook is the `data-testid`
 * Anthropic ships on the message bubbles, plus a fallback on `[class*="font-claude"]`
 * for the markdown body.
 */

import { attachAdapter, type PlatformAdapter } from "./shared";

const claudeAdapter: PlatformAdapter = {
  name: "Claude",
  // Claude.ai's assistant message bubble — multiple variants observed.
  // Combined selector tolerates both new and legacy markup.
  assistantMessageSelector:
    "[data-testid='message-content']:not([data-author='user']), " +
    "div.font-claude-message, " +
    "div[data-is-streaming]",

  extractText(messageEl: Element): string | null {
    // Anthropic uses prose-style markdown blocks
    const proseEls = messageEl.querySelectorAll<HTMLElement>(
      ".prose, .markdown, .claude-message-content, p, li, pre, code",
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
    // Look up to find a "conversation" container, then walk back for the
    // preceding user message
    const conversation =
      messageEl.closest("[data-testid='conversation']") ||
      messageEl.closest("main");
    if (!conversation) return "Claude response";

    // Find sibling user message before this assistant message
    const allMessages = Array.from(
      conversation.querySelectorAll<HTMLElement>(
        "[data-testid='user-message'], [data-author='user']",
      ),
    );
    const last = allMessages.at(-1);
    if (last) {
      const text = last.innerText?.trim();
      if (text && text.length > 0 && text.length < 500) {
        return `Claude response to: "${text.slice(0, 200)}"`;
      }
    }
    return "Claude response";
  },
};

attachAdapter(claudeAdapter);
