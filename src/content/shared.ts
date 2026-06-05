/**
 * Shared content-script helpers.
 *
 * Each platform (chatgpt, claude, gemini, deepseek) has its own DOM selectors
 * but the badge rendering and message-passing logic are platform-independent —
 * they live here.
 */

import type {
  ExtensionSettings,
  RuntimeMessage,
  VerifyCitationRequest,
  VerifyCitationResponse,
} from "../types";

import { loadSettings } from "../storage";
import { placeAnswerButton, placeLinkIcons, placeSentenceIcons } from "./inline";

// ───────────────────────────────────────────────────────────────────
// ENIGMA Memory — explicit "insert my verified context" affordance.
// Shown only when signed in AND Memory is enabled. Clicking fetches the user's
// memory context (via the background, authed) and INSERTS it into the prompt
// composer — the user sees it, can edit it, and sends it themselves. We never
// auto-send or silently rewrite. This is the consensual, transparent version.
// ───────────────────────────────────────────────────────────────────

function findComposer(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.tagName === "TEXTAREA" || active.isContentEditable)) {
    return active;
  }
  const selectors = [
    "#prompt-textarea",
    "div.ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']",
    "textarea#chat-input",
    "main form div[contenteditable='true']",
    "form textarea",
    "div[contenteditable='true']",
    "textarea",
  ];
  for (const s of selectors) {
    const el = document.querySelector<HTMLElement>(s);
    if (el) return el;
  }
  return null;
}

function insertIntoComposer(text: string): boolean {
  const el = findComposer();
  if (!el) return false;
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    const cur = el.value;
    el.value = text + (cur ? `\n\n${cur}` : "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (el.isContentEditable) {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand("insertText", false, `${text}\n\n`);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function memToast(message: string): void {
  const t = document.createElement("div");
  t.className = "enigma-mem-toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function getMemoryContext(): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "MEMORY_REQUEST", op: "context" },
      (resp?: RuntimeMessage) => {
        if (
          !chrome.runtime.lastError &&
          resp?.type === "MEMORY_RESPONSE" &&
          resp.ok &&
          resp.context
        ) {
          resolve(resp.context);
        } else {
          resolve("");
        }
      },
    );
  });
}

let memoryBtn: HTMLButtonElement | null = null;

function ensureMemoryButton(): HTMLButtonElement {
  if (memoryBtn && document.body.contains(memoryBtn)) return memoryBtn;
  const btn = document.createElement("button");
  btn.className = "enigma-mem-fab";
  btn.type = "button";
  btn.title = "Insert your ENIGMA Memory (verified context) into this prompt";
  btn.textContent = "🧠 ENIGMA Memory";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void (async () => {
      btn.disabled = true;
      const ctx = await getMemoryContext();
      btn.disabled = false;
      if (!ctx) {
        memToast("Your ENIGMA Memory is empty — verify some sources first.");
        return;
      }
      if (insertIntoComposer(ctx)) {
        memToast("Added your verified memory to the prompt — edit, then send.");
      } else {
        void navigator.clipboard?.writeText(ctx).catch(() => {});
        memToast("Copied your memory — paste it into the chat box.");
      }
    })();
  });
  document.body.appendChild(btn);
  memoryBtn = btn;
  return btn;
}

function updateMemoryButton(s: ExtensionSettings): void {
  const show = Boolean(s.enabled && s.authToken && s.memoryEnabled);
  if (show) {
    ensureMemoryButton().style.display = "";
  } else if (memoryBtn) {
    memoryBtn.style.display = "none";
  }
}

// Icons are placed on the fly as the answer streams: we scan at most once per
// SCAN_THROTTLE_MS while text is arriving (placing icons only for sentences
// that have already completed), then run one final pass STREAM_SETTLE_MS after
// the stream goes quiet to catch the last sentence. No verification happens
// during streaming — icons are just anchors; the API call waits for a click.
const SCAN_THROTTLE_MS = 450;
const STREAM_SETTLE_MS = 800;

// Hard cap on the text we send for verification. Kept in sync with the
// server's claim_text max_length (verify/app/models/schemas.py); truncating
// here means a very long answer is trimmed instead of rejected with HTTP 422.
// JS string length counts UTF-16 units (>= Python's char count), so slicing
// at this value guarantees the server-side character limit is never exceeded.
const MAX_CLAIM_CHARS = 50000;

/**
 * Adapter that each platform script must implement.
 */
export interface PlatformAdapter {
  /** Human-readable platform name for logging + telemetry. */
  readonly name: string;

  /**
   * CSS selector that matches each "assistant message" block.
   * Examples:
   *   chatgpt:   "div[data-message-author-role='assistant']"
   *   claude:    "div[data-testid='message-content']"
   */
  readonly assistantMessageSelector: string;

  /**
   * Given a matched assistant message element, return the raw text content
   * that should be sent for verification. May return null for non-text
   * messages (images, tool calls).
   */
  extractText(messageEl: Element): string | null;

  /**
   * Optional: extract any platform-specific context that helps verification
   * (e.g., the chat title, the user's prior question).
   */
  extractContext?(messageEl: Element): string | null;
}

/**
 * Inject the badge stylesheet once per page load.
 * Uses chrome.runtime.getURL to satisfy MV3 CSP.
 */
let stylesheetInjected = false;
export function injectBadgeStylesheet(): void {
  if (stylesheetInjected) return;
  stylesheetInjected = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("styles/badge.css");
  document.head.appendChild(link);
}

/**
 * Send a VERIFY_REQUEST to the background service worker and await the response.
 */
export function sendVerifyRequest(
  payload: VerifyCitationRequest,
): Promise<VerifyCitationResponse> {
  const id = `verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const message: RuntimeMessage = { type: "VERIFY_REQUEST", id, payload };
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeMessage) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.type === "VERIFY_RESPONSE" && response.id === id) {
        resolve(response.data);
      } else if (response?.type === "VERIFY_ERROR" && response.id === id) {
        reject(new Error(response.error));
      } else {
        reject(new Error("Unexpected response from background"));
      }
    });
  });
}

/**
 * Render a verdict badge on top of an assistant message.
 */
function renderBadge(
  messageEl: Element,
  response: VerifyCitationResponse,
): void {
  // Remove any prior badge
  const existing = messageEl.querySelector(".enigma-badge");
  existing?.remove();

  const badge = document.createElement("div");
  badge.className = `enigma-badge enigma-verdict-${response.verdict}`;

  const icon = document.createElement("span");
  icon.className = "enigma-badge-icon";
  switch (response.verdict) {
    case "true":
      icon.textContent = "✓"; // check mark
      break;
    case "false":
      icon.textContent = "✗"; // ballot X
      break;
    case "uncertain":
      icon.textContent = "?";
      break;
    default:
      icon.textContent = "—"; // em-dash
  }

  const label = document.createElement("span");
  label.className = "enigma-badge-label";
  const confidence = Math.round(response.confidence * 100);
  switch (response.verdict) {
    case "true":
      label.textContent = `Verified (${confidence}%)`;
      break;
    case "false":
      label.textContent = `Likely false (${confidence}%)`;
      break;
    case "uncertain":
      label.textContent = `Uncertain (${confidence}%)`;
      break;
    default:
      label.textContent = "Not verifiable";
  }

  badge.appendChild(icon);
  badge.appendChild(label);

  // Click to expand
  badge.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleDetails(messageEl, response);
  });

  messageEl.prepend(badge);
}

function toggleDetails(
  messageEl: Element,
  response: VerifyCitationResponse,
): void {
  const existing = messageEl.querySelector(".enigma-details");
  if (existing) {
    existing.remove();
    return;
  }

  const details = document.createElement("div");
  details.className = "enigma-details";

  if (response.explanation) {
    const explain = document.createElement("p");
    explain.className = "enigma-details-explanation";
    explain.textContent = response.explanation;
    details.appendChild(explain);
  }

  if (response.citations_found.length > 0) {
    const list = document.createElement("ul");
    list.className = "enigma-details-citations";
    for (const c of response.citations_found) {
      const li = document.createElement("li");
      const status = c.verification.exists ? "✓" : "✗";
      li.textContent = `${status} ${c.citation.citation_text}`;
      if (c.verification.matched_source) {
        li.title = `Matched in: ${c.verification.matched_source}`;
      } else if (c.verification.note) {
        li.title = c.verification.note;
      }
      list.appendChild(li);
    }
    details.appendChild(list);
  }

  if (response.multi_llm && response.multi_llm.actual_value_consensus) {
    const llm = document.createElement("p");
    llm.className = "enigma-details-llm";
    llm.innerHTML =
      "<strong>Multi-LLM consensus says:</strong> " +
      escapeHtml(response.multi_llm.actual_value_consensus);
    details.appendChild(llm);
  }

  const footer = document.createElement("p");
  footer.className = "enigma-details-footer";
  footer.textContent = `Verified in ${response.verification_time_ms}ms · `;
  const link = document.createElement("a");
  link.href = "https://axiom.enigma.ist/privacy";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Privacy policy";
  footer.appendChild(link);
  details.appendChild(footer);

  const badge = messageEl.querySelector(".enigma-badge");
  badge?.insertAdjacentElement("afterend", details);
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ───────────────────────────────────────────────────────────────────
// Verification core — shared by auto-badging and manual "verify last"
// ───────────────────────────────────────────────────────────────────

/** The adapter for the current page; set when attachAdapter runs. */
let activeAdapter: PlatformAdapter | null = null;

/**
 * Verify one assistant message and render its badge. No dedup here — the
 * caller decides whether to skip messages that were already verified.
 */
async function verifyAndRender(
  messageEl: Element,
  adapter: PlatformAdapter,
): Promise<VerifyCitationResponse> {
  const extracted = adapter.extractText(messageEl);
  if (!extracted) throw new Error("No text found in this response.");
  const text =
    extracted.length > MAX_CLAIM_CHARS
      ? extracted.slice(0, MAX_CLAIM_CHARS)
      : extracted;
  const context =
    adapter.extractContext?.(messageEl) ?? `${adapter.name} response`;
  const response = await sendVerifyRequest({
    claim_text: text,
    context,
    options: {
      include_multi_llm_check: true,
      verify_citations: true,
      return_explanation: true,
    },
  });
  renderBadge(messageEl, response);
  return response;
}

/** Find the last assistant message on the page with enough text to verify. */
function findLastAssistantMessage(adapter: PlatformAdapter): Element | null {
  const all = Array.from(
    document.querySelectorAll(adapter.assistantMessageSelector),
  );
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (!el) continue;
    const text = adapter.extractText(el);
    if (text && text.trim().length >= 20) return el;
  }
  return null;
}

/** Show a transient "Verifying…" badge while the request is in flight. */
function renderPendingBadge(messageEl: Element): void {
  messageEl.querySelector(".enigma-badge")?.remove();
  messageEl.querySelector(".enigma-details")?.remove();
  const badge = document.createElement("div");
  badge.className = "enigma-badge enigma-verdict-pending";
  const icon = document.createElement("span");
  icon.className = "enigma-badge-icon";
  icon.textContent = "⏳";
  const label = document.createElement("span");
  label.className = "enigma-badge-label";
  label.textContent = "Verifying…";
  badge.appendChild(icon);
  badge.appendChild(label);
  messageEl.prepend(badge);
}

/**
 * Handle a manual "verify last response" request from the popup: locate the
 * latest assistant message, scroll it into view, and verify it on demand —
 * independent of scroll position or whether auto-badging already ran.
 */
async function handleVerifyLast(): Promise<RuntimeMessage> {
  if (!activeAdapter) {
    return {
      type: "VERIFY_LAST_RESULT",
      ok: false,
      error: "ENIGMA Axiom is not active on this page.",
    };
  }
  const messageEl = findLastAssistantMessage(activeAdapter);
  if (!messageEl) {
    return {
      type: "VERIFY_LAST_RESULT",
      ok: false,
      error: `No ${activeAdapter.name} response found on this page yet.`,
    };
  }
  messageEl.scrollIntoView({ behavior: "smooth", block: "center" });
  renderPendingBadge(messageEl);
  try {
    const response = await verifyAndRender(messageEl, activeAdapter);
    return {
      type: "VERIFY_LAST_RESULT",
      ok: true,
      verdict: response.verdict,
      confidence: response.confidence,
      platform: activeAdapter.name,
    };
  } catch (err) {
    messageEl.querySelector(".enigma-badge")?.remove();
    return {
      type: "VERIFY_LAST_RESULT",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Register the popup→content message listener exactly once per page. */
let messageListenerRegistered = false;
function registerMessageListener(): void {
  if (messageListenerRegistered) return;
  messageListenerRegistered = true;
  chrome.runtime.onMessage.addListener(
    (
      message: RuntimeMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: RuntimeMessage) => void,
    ): boolean => {
      if (message?.type === "VERIFY_LAST_REQUEST") {
        void handleVerifyLast().then(sendResponse);
        return true; // keep the channel open for the async response
      }
      return false; // not ours
    },
  );
}

/**
 * Wire up an adapter — watches the DOM, dedupes, and renders badges. Also
 * registers the manual "verify last" listener for the popup button.
 */
export function attachAdapter(adapter: PlatformAdapter): void {
  injectBadgeStylesheet();
  activeAdapter = adapter;
  registerMessageListener();
  console.info(
    `[ENIGMA Axiom] attached adapter for ${adapter.name} on ${location.host}`,
  );

  // Per-message debounce so we act only on the FINAL streamed text, not on a
  // half-written answer.
  const settleTimers = new Map<Element, number>();
  const lastSeenText = new Map<Element, string>();
  const lastScanAt = new Map<Element, number>();
  let enabled = true; // master switch from popup settings (now enforced)

  function armSettleTimer(messageEl: Element): void {
    const prev = settleTimers.get(messageEl);
    if (prev !== undefined) clearTimeout(prev);
    const handle = window.setTimeout(() => {
      settleTimers.delete(messageEl);
      onSettled(messageEl, true);
    }, STREAM_SETTLE_MS);
    settleTimers.set(messageEl, handle);
  }

  /** Called on every mutation touching a message; (re)starts its settle timer. */
  function noteActivity(messageEl: Element): void {
    const text = adapter.extractText(messageEl) ?? "";
    if (lastSeenText.get(messageEl) === text) {
      // Cosmetic mutation (no text change) — let any pending timer keep running,
      // but make sure stable, already-complete messages still get a timer.
      if (!settleTimers.has(messageEl)) armSettleTimer(messageEl);
      return;
    }
    lastSeenText.set(messageEl, text);
    // Eager, throttled scan so icons appear AS the answer streams (placing only
    // sentences that have already completed).
    const now = Date.now();
    if (now - (lastScanAt.get(messageEl) ?? 0) >= SCAN_THROTTLE_MS) {
      lastScanAt.set(messageEl, now);
      onSettled(messageEl, false);
    }
    armSettleTimer(messageEl); // final pass once the stream goes quiet
  }

  /**
   * A message finished streaming: scan it for verifiable citations and place
   * inline ENIGMA icons. No verification happens until the user clicks one.
   */
  function onSettled(messageEl: Element, final: boolean): void {
    if (!enabled) return;
    try {
      placeSentenceIcons(messageEl, sendVerifyRequest, adapter.name, final);
      placeLinkIcons(messageEl, sendVerifyRequest, adapter.name);
      placeAnswerButton(
        messageEl,
        sendVerifyRequest,
        adapter.name,
        () => adapter.extractText(messageEl) ?? "",
      );
    } catch (err) {
      console.warn("[ENIGMA Axiom] icon placement failed:", err);
    }
  }

  function rescanAll(): void {
    document
      .querySelectorAll(adapter.assistantMessageSelector)
      .forEach((el) => noteActivity(el));
  }

  // Respect the popup's enable/disable toggle (previously not enforced) and
  // do the initial scan of already-present messages once settings are known.
  void loadSettings().then((s) => {
    enabled = s.enabled;
    updateMemoryButton(s);
    if (enabled) rescanAll();
  });
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "local") return;
    void loadSettings().then((s) => {
      const was = enabled;
      enabled = s.enabled;
      updateMemoryButton(s);
      if (!enabled) {
        document
          .querySelectorAll(".enigma-inline-icon")
          .forEach((el) => el.remove());
      } else if (!was) {
        rescanAll();
      }
    });
  });

  // Observe future mutations: new messages AND streaming text updates. We
  // watch characterData so each appended token resets the per-message timer;
  // placement fires once the stream goes quiet for STREAM_SETTLE_MS.
  const observer = new MutationObserver((mutations) => {
    const touched = new Set<Element>();
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(adapter.assistantMessageSelector)) touched.add(node);
        node
          .querySelectorAll?.(adapter.assistantMessageSelector)
          .forEach((el) => touched.add(el));
      }
      const target =
        m.target instanceof Element ? m.target : m.target.parentElement;
      const host = target?.closest(adapter.assistantMessageSelector) ?? null;
      if (host) touched.add(host);
    }
    for (const el of touched) noteActivity(el);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
