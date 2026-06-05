/**
 * Inline per-sentence verification.
 *
 * Scans an assistant message for VERIFIABLE citations (DOI / arXiv / PMID /
 * US case law) and places a small ENIGMA Axiom icon at the end of each
 * sentence that contains one. Clicking the icon verifies *just that sentence*
 * and shows the result in a floating popover, where the user can optionally
 * refine the check with a category (→ domain) or a free-text hint (→ context).
 *
 * We only mark sentences we can actually verify in Phase 1 — plain URLs and
 * bare "[1]" refs are intentionally ignored (the backend can't resolve them),
 * so we never hang an icon on something we can't check.
 *
 * No verification happens until the user clicks an icon (zero auto API calls).
 */

import type {
  AuthUser,
  Domain,
  GoalDecomposition,
  GoalNode,
  VerifyCitationRequest,
  VerifyCitationResponse,
  VerifyMethods,
} from "../types";
import { loadSettings, saveSettings } from "../storage";
import { GOAL_PRESETS, seedPresetGoals } from "../goals-presets";

export type VerifyFn = (
  req: VerifyCitationRequest,
) => Promise<VerifyCitationResponse>;

/** Current sign-in state, read from extension storage (set by the SSO refresh). */
async function getAuth(): Promise<{ signedIn: boolean; user: AuthUser | null }> {
  try {
    const s = await loadSettings();
    return { signedIn: Boolean(s.authToken), user: s.user };
  } catch {
    return { signedIn: false, user: null };
  }
}

/** A small "signed in as …" chip (avatar + name), or null when signed out. */
function accountChip(user: AuthUser | null): HTMLElement | null {
  if (!user) return null;
  const chip = document.createElement("div");
  chip.className = "enigma-account";
  if (user.avatar) {
    const img = document.createElement("img");
    img.className = "enigma-account-avatar";
    img.src = user.avatar;
    img.alt = "";
    chip.appendChild(img);
  }
  const name = document.createElement("span");
  name.className = "enigma-account-name";
  name.textContent =
    user.name || (user.username ? `@${user.username}` : "Signed in");
  chip.appendChild(name);
  return chip;
}

const CITE_ATTR = "data-enigma-cite";

// Where "sign up for more" sends users to lift the free IP limit. Matches the
// backend register_url; the page goes live when axiom.enigma.ist is built.
const REGISTER_URL = "https://axiom.enigma.ist/register";

// ───────────────────────────────────────────────────────────────────
// Citation detection (client-side; mirrors the verifiable types the
// backend resolves in verify/app/services/citation_extractor.py)
// ───────────────────────────────────────────────────────────────────

interface DetectedCitation {
  type: "doi" | "arxiv" | "pmid" | "case_law" | "author_year";
  index: number; // start offset in the scanned text
  end: number; // end offset (exclusive)
  value: string; // the literal citation text (stable identity across stream)
}

const PATTERNS: { type: DetectedCitation["type"]; re: RegExp }[] = [
  { type: "doi", re: /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/g },
  { type: "arxiv", re: /arxiv:\s*\d{4}\.\d{4,5}(?:v\d+)?/gi },
  { type: "pmid", re: /pmid:\s*\d{1,9}/gi },
  {
    type: "case_law",
    re: /\b[A-Z][A-Za-z.'’-]+\s+v\.?\s+[A-Z][A-Za-z.'’-]+,\s+\d+\s+[A-Z][A-Za-z.]*\.?\s+\d+/g,
  },
  // No-DOI academic references: "Smith (2020)", "Vaswani et al. (2017)",
  // "Xu and Arjmandzadeh (2023)", "Smith & Jones (2020)". Resolved server-side
  // via Crossref bibliographic search (+ author/year validation).
  {
    type: "author_year",
    re: /\b[A-Z][A-Za-z'’\-]{1,}(?:\s+(?:et al\.?|and\s+[A-Z][A-Za-z'’\-]+|&\s+[A-Z][A-Za-z'’\-]+))?\s*\((?:18|19|20)\d{2}[a-z]?\)/g,
  },
];

/** Trailing punctuation that should not be considered part of a citation. */
function trimTrailingPunct(s: string): number {
  let n = s.length;
  while (n > 0 && /[.,;:)\]}]/.test(s[n - 1] ?? "")) n--;
  return n;
}

function detectCitations(text: string): DetectedCitation[] {
  const found: DetectedCitation[] = [];
  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0];
      const trimmedLen =
        type === "doi" || type === "arxiv" ? trimTrailingPunct(raw) : raw.length;
      if (trimmedLen <= 0) continue;
      found.push({
        type,
        index: m.index,
        end: m.index + trimmedLen,
        value: raw.slice(0, trimmedLen),
      });
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

// ── Sentence boundaries (citations contain dots, so scan around the match) ──

function sentenceEndAfter(text: string, from: number): number {
  for (let i = Math.max(0, from); i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?") {
      const next = text[i + 1] ?? " ";
      if (/\s/.test(next) || i + 1 === text.length) return i + 1;
    }
    if (ch === "\n") return i; // newline ends a sentence/list item
  }
  return text.length;
}

function sentenceStartBefore(text: string, from: number): number {
  for (let i = Math.min(from, text.length) - 1; i > 0; i--) {
    const ch = text[i];
    if (ch === "\n") return i + 1;
    if (ch === "." || ch === "!" || ch === "?") {
      const next = text[i + 1] ?? "";
      if (/\s/.test(next)) return i + 1;
    }
  }
  return 0;
}

function hashKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

// ───────────────────────────────────────────────────────────────────
// DOM text mapping + icon insertion
// ───────────────────────────────────────────────────────────────────

interface TextSeg {
  node: Text;
  start: number;
}

function collectTextSegments(root: Element): {
  fullText: string;
  segs: TextSeg[];
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // Don't scan code blocks or our own injected UI.
      if (parent.closest("pre, .enigma-inline-icon, .enigma-popover, .enigma-badge, .enigma-details")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let fullText = "";
  const segs: TextSeg[] = [];
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    segs.push({ node: t, start: fullText.length });
    fullText += t.data;
    n = walker.nextNode();
  }
  return { fullText, segs };
}

function locate(segs: TextSeg[], offset: number): { node: Text; offset: number } | null {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s && offset >= s.start) {
      return { node: s.node, offset: Math.min(offset - s.start, s.node.data.length) };
    }
  }
  return null;
}

let iconUrl = "";
function getIconUrl(): string {
  if (!iconUrl) {
    try {
      iconUrl = chrome.runtime.getURL("icons/icon-32.png");
    } catch {
      iconUrl = "";
    }
  }
  return iconUrl;
}

function buildIcon(key: string, type: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "enigma-inline-icon";
  icon.setAttribute(CITE_ATTR, key);
  icon.setAttribute("role", "button");
  icon.setAttribute("tabindex", "0");
  icon.title = `Verify this ${type.replace("_", " ")} with ENIGMA Axiom`;
  const url = getIconUrl();
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "ENIGMA Axiom";
    img.className = "enigma-inline-icon-img";
    icon.appendChild(img);
  } else {
    icon.textContent = "⚡";
  }
  return icon;
}

interface SentenceEntry {
  sentence: string; // text sent to the backend as claim_text
  type: string; // citation-type label (icon tooltip / card)
  display?: string; // friendlier text shown in the popover quote (defaults to sentence)
  titleLookup?: boolean; // verify as a bare reference TITLE (no DOI) via bibliographic search
  urlLookup?: boolean; // verify a cited web URL by fetching its page metadata server-side
  noLLM?: boolean; // never run the LLM cross-check — algorithm only, no spend
}

// Stable across re-renders: keyed by sentence-text hash.
const sentenceStore = new Map<string, SentenceEntry>();

/**
 * Scan an assistant message and place an icon at the end of every sentence
 * that contains a verifiable citation.
 *
 * Designed to run repeatedly WHILE the answer streams (called on a throttle),
 * so icons appear on the fly instead of only after the whole answer finishes:
 * - dedupe by the first citation's literal value (stable as the stream grows),
 *   not by sentence text (which keeps changing) — so re-scans never duplicate;
 * - only place once a sentence is COMPLETE (another sentence has started after
 *   it, or it ends in terminal punctuation) so the icon doesn't land mid-write.
 *   `final=true` (the post-stream pass) relaxes this to catch the last sentence.
 * Also re-injects any icon the host page wiped on re-render.
 */
export function placeSentenceIcons(
  messageEl: Element,
  verify: VerifyFn,
  platformName: string,
  final: boolean,
): void {
  const { fullText, segs } = collectTextSegments(messageEl);
  if (fullText.length < 10) return;

  const cites = detectCitations(fullText);
  if (cites.length === 0) return;

  // Group: one icon per sentence, keyed by that sentence's FIRST citation value.
  const inserts: { key: string; end: number; type: string }[] = [];
  let lastSentenceEnd = -1;
  for (const c of cites) {
    if (c.index < lastSentenceEnd) continue; // same sentence as a prior citation
    const sStart = sentenceStartBefore(fullText, c.index);
    const sEnd = sentenceEndAfter(fullText, c.end);
    lastSentenceEnd = sEnd;

    const sentence = fullText.slice(sStart, sEnd).trim();
    if (sentence.length < 8) continue;

    // Complete = something follows this sentence, or it ends in . ! ? — else
    // it's the still-streaming tail (place only on the final pass).
    const complete = final || sEnd < fullText.length || /[.!?]$/.test(sentence);
    if (!complete) continue;

    const key = hashKey(c.value); // stable identity
    sentenceStore.set(key, { sentence, type: c.type });
    if (messageEl.querySelector(`[${CITE_ATTR}="${key}"]`)) continue; // already placed
    inserts.push({ key, end: sEnd, type: c.type });
  }

  // Insert from the rightmost offset first so earlier offsets stay valid after
  // splitText mutates the text nodes.
  inserts.sort((a, b) => b.end - a.end);
  for (const { key, end, type } of inserts) {
    const loc = locate(segs, end);
    if (!loc || !loc.node.parentNode) continue;
    const after = loc.node.splitText(loc.offset);
    const icon = buildIcon(key, type);
    const open = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      const entry = sentenceStore.get(key);
      if (entry) openPopover(icon, entry, platformName, verify);
    };
    icon.addEventListener("click", open);
    icon.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    });
    loc.node.parentNode.insertBefore(icon, after);
  }
}

// ───────────────────────────────────────────────────────────────────
// Reference-link icons: hang an icon on every <a> that points to a paper.
// A link whose href carries a DOI/arXiv/PMID verifies that identifier; any
// other titled link is treated as a paper TITLE and resolved via bibliographic
// search — this catches the very common "the AI linked to a paper that does
// not actually exist". Auto link checks are ALGORITHM-ONLY (no LLM spend).
// ───────────────────────────────────────────────────────────────────

/** Hosts whose links are app navigation / web-search chrome, not references. */
function isUiHost(host: string): boolean {
  return /(?:^|\.)(?:chatgpt\.com|openai\.com|claude\.ai|anthropic\.com|gemini\.google\.com|google\.com|deepseek\.com|bing\.com)$/i.test(
    host,
  );
}

/** Pull a verifiable identifier out of a link href, if one is present. */
function citationFromHref(href: string): { claim: string; type: string } | null {
  const doi = href.match(/10\.\d{4,9}\/[^\s"'?#<>]+/);
  if (doi) {
    return { claim: doi[0].replace(/[).,;]+$/, ""), type: "doi" };
  }
  const arx = href.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i);
  if (arx) return { claim: `arXiv:${arx[1]}`, type: "arxiv" };
  const pmid = href.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d{4,9})/i);
  if (pmid) return { claim: `PMID:${pmid[1]}`, type: "pmid" };
  return null;
}

/**
 * True when a link's visible text is plausibly a paper TITLE we can resolve via
 * bibliographic search — not a ChatGPT source pill whose label is just the
 * domain ("actaphilosophica.it+1") or a bare URL. A real title has multiple
 * words and isn't a hostname; resolving a domain pill as a title would wrongly
 * report a real journal article "fabricated", so we skip those (we can't verify
 * an arbitrary web page in Phase 1).
 */
function isLikelyTitle(text: string, href: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  // "domain.tld", "domain.tld+2", "https://…", "www.…" — a source-pill label.
  if (/^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\s*\+\s*\d+)?\/?$/i.test(t)) return false;
  if (/^www\./i.test(t) || /:\/\//.test(t)) return false;
  // Label is just the link's host (optionally with a "+N" more-sources suffix).
  try {
    const host = new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
    const label = t
      .replace(/\s*\+\s*\d+\s*$/, "")
      .replace(/^www\./i, "")
      .toLowerCase();
    if (label === host) return false;
  } catch {
    /* unparseable href — fall through to the word check */
  }
  // A real title is multi-word.
  return t.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length >= 2;
}

/**
 * Scan an assistant message for reference links and hang a verify icon on each.
 * Idempotent: re-running (during/after stream) never duplicates an icon and
 * re-injects any the host page wiped on re-render.
 */
export function placeLinkIcons(
  messageEl: Element,
  verify: VerifyFn,
  platformName: string,
): void {
  const anchors = messageEl.querySelectorAll<HTMLAnchorElement>("a[href^='http']");
  for (const a of Array.from(anchors)) {
    if (a.closest("pre, code")) continue; // not code samples
    if (a.classList.contains("enigma-cite-link")) continue; // our own UI links

    let host = "";
    try {
      host = new URL(a.href).host;
    } catch {
      continue;
    }
    if (isUiHost(host)) continue;

    const text = (a.textContent || "").trim();
    const fromHref = citationFromHref(a.href);
    const titleLike = !fromHref && isLikelyTitle(text, a.href);

    const key = hashKey(`L:${a.href}|${text}`);
    if (messageEl.querySelector(`.enigma-inline-icon[${CITE_ATTR}="${key}"]`)) {
      continue; // already iconned and the icon is still present
    }

    // Three ways to verify a reference link:
    //  - a DOI/arXiv/PMID in the href → check that identifier;
    //  - link text that is plausibly a paper title → bibliographic title search;
    //  - otherwise (a source pill / bare journal URL) → fetch the page server-
    //    side and read its citation metadata (url_lookup).
    const displayHost = host.replace(/^www\./i, "");
    let entry: SentenceEntry;
    let iconType: string;
    if (fromHref) {
      entry = {
        sentence: fromHref.claim,
        type: fromHref.type,
        display: text || fromHref.claim,
        noLLM: true,
      };
      iconType = fromHref.type;
    } else if (titleLike) {
      entry = { sentence: text, type: "title", display: text, titleLookup: true, noLLM: true };
      iconType = "reference title";
    } else {
      entry = {
        sentence: a.href,
        type: "source link",
        display: text || displayHost || a.href,
        urlLookup: true,
        noLLM: true,
      };
      iconType = "source link";
    }

    const icon = buildIcon(key, iconType);
    const open = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      openPopover(icon, entry, platformName, verify);
    };
    icon.addEventListener("click", open);
    icon.addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === "Enter" || k === " ") open(e);
    });
    a.insertAdjacentElement("afterend", icon);
  }
}

// ───────────────────────────────────────────────────────────────────
// Result popover
// ───────────────────────────────────────────────────────────────────

let activePopover: HTMLElement | null = null;

function onDocClick(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (
    activePopover &&
    !activePopover.contains(target) &&
    !target?.closest?.(".enigma-inline-icon")
  ) {
    closePopover();
  }
}

function closePopover(): void {
  activePopover?.remove();
  activePopover = null;
  document.removeEventListener("click", onDocClick, true);
}

const CATEGORIES: { label: string; domain: Domain | "" }[] = [
  { label: "Auto-detect", domain: "" },
  { label: "Academic", domain: "academic" },
  { label: "Legal / law", domain: "legal" },
  { label: "Medical", domain: "medical" },
  { label: "General", domain: "general" },
];

function verdictClass(v: string): string {
  if (v === "true") return "enigma-verdict-true";
  if (v === "false") return "enigma-verdict-false";
  if (v === "uncertain") return "enigma-verdict-uncertain";
  return "enigma-verdict-not_applicable";
}

function verdictLabel(v: string, confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (v === "true") return `Verified (${pct}%)`;
  if (v === "false") return `Likely false (${pct}%)`;
  if (v === "uncertain") return `Uncertain (${pct}%)`;
  return "Not verifiable";
}

/**
 * Position a floating element near its anchor, kept fully inside the viewport.
 * Opens below the anchor when there's room, otherwise above; caps max-height to
 * the available space so it scrolls internally instead of running off-screen.
 * Uses fixed positioning so it stays put as the page scrolls.
 */
function placeFloating(el: HTMLElement, anchor: HTMLElement, width: number): void {
  const r = anchor.getBoundingClientRect();
  const m = 8;
  el.style.position = "fixed";
  el.style.width = `${width}px`;
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 12))}px`;
  el.style.overflowY = "auto";
  const below = window.innerHeight - r.bottom - m;
  const above = r.top - m;
  if (below >= above) {
    el.style.top = `${r.bottom + m}px`;
    el.style.maxHeight = `${Math.max(160, below)}px`;
  } else {
    el.style.top = `${m}px`;
    el.style.maxHeight = `${Math.max(160, above)}px`;
  }
}

function openPopover(
  anchor: HTMLElement,
  entry: SentenceEntry,
  platformName: string,
  verify: VerifyFn,
): void {
  closePopover();

  const pop = document.createElement("div");
  pop.className = "enigma-popover";
  placeFloating(pop, anchor, 360);

  // Header
  const header = document.createElement("div");
  header.className = "enigma-popover-header";
  const title = document.createElement("span");
  title.className = "enigma-popover-title";
  title.textContent = "ENIGMA Axiom";
  const account = document.createElement("div");
  account.className = "enigma-popover-account";
  const close = document.createElement("button");
  close.className = "enigma-popover-close";
  close.textContent = "✕";
  close.title = "Close";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closePopover();
  });
  header.appendChild(title);
  header.appendChild(account);
  header.appendChild(close);

  // Quoted sentence (show the friendly title/text, not a raw DOI, when given)
  const quote = document.createElement("div");
  quote.className = "enigma-popover-quote";
  quote.textContent = entry.display || entry.sentence;

  // Result body
  const body = document.createElement("div");
  body.className = "enigma-popover-body";

  // Refine controls
  const refine = document.createElement("div");
  refine.className = "enigma-popover-refine";
  const select = document.createElement("select");
  select.className = "enigma-popover-select";
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c.domain;
    opt.textContent = c.label;
    select.appendChild(opt);
  }
  const hint = document.createElement("input");
  hint.type = "text";
  hint.className = "enigma-popover-hint";
  hint.placeholder = "Optional hint (e.g. what to check)";
  // AI cross-check toggle — disabled until we confirm the user is signed in
  // (AI is a signed-in feature; algorithm checks stay free for everyone).
  const aiLabel = document.createElement("label");
  aiLabel.className = "enigma-popover-ai";
  aiLabel.title = "Sign in (ENIGMA Axiom popup) to use the AI cross-check";
  const aiBox = document.createElement("input");
  aiBox.type = "checkbox";
  aiBox.disabled = true;
  aiLabel.appendChild(aiBox);
  aiLabel.appendChild(
    Object.assign(document.createElement("span"), { textContent: "AI" }),
  );
  const recheck = document.createElement("button");
  recheck.className = "enigma-popover-recheck";
  recheck.textContent = "Re-check";
  refine.appendChild(select);
  refine.appendChild(aiLabel);
  refine.appendChild(hint);
  refine.appendChild(recheck);

  // Reflect sign-in: show the account chip + enable the AI toggle.
  void getAuth().then(({ signedIn, user }) => {
    const chip = accountChip(user);
    if (chip) account.appendChild(chip);
    if (signedIn) {
      aiBox.disabled = false;
      aiLabel.title = "Run an independent AI cross-check";
      aiLabel.classList.add("enigma-popover-ai-on");
    }
  });

  // Footer: free-tier note + register call-to-action.
  const footer = document.createElement("div");
  footer.className = "enigma-popover-footer";
  const note = document.createElement("span");
  note.className = "enigma-popover-free";
  note.textContent = "Free: 20 checks / 4h";
  const register = document.createElement("a");
  register.className = "enigma-popover-register";
  register.href = REGISTER_URL;
  register.target = "_blank";
  register.rel = "noopener noreferrer";
  register.textContent = "Sign up for more →";
  footer.appendChild(note);
  footer.appendChild(register);

  pop.appendChild(header);
  pop.appendChild(quote);
  pop.appendChild(body);
  pop.appendChild(refine);
  pop.appendChild(footer);
  document.body.appendChild(pop);
  activePopover = pop;
  // Defer outside-click wiring so this same click doesn't immediately close it.
  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);

  async function run(): Promise<void> {
    const domain = (select.value || null) as Domain | null;
    const hintText = hint.value.trim();
    // User explicitly opted into AI (only possible when signed in — the box is
    // disabled otherwise). This forces the cross-check even for a title/link.
    const wantAI = aiBox.checked && !aiBox.disabled;
    body.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "enigma-popover-loading";
    loading.textContent = wantAI ? "Verifying with AI cross-check…" : "Verifying…";
    body.appendChild(loading);
    recheck.disabled = true;
    try {
      const resp = await verify({
        claim_text: entry.sentence,
        context: hintText
          ? `${platformName} response — ${hintText}`
          : `${platformName} response`,
        domain,
        options: {
          // Default: link/title auto-checks stay algorithm-only (no LLM spend);
          // citation icons keep the LLM available but the backend gates it (a
          // resolved DOI never triggers a paid call). Checking "AI" forces it.
          include_multi_llm_check: wantAI ? true : !entry.noLLM,
          verify_citations: true,
          return_explanation: true,
          force_claim_check: wantAI,
          title_lookup: entry.titleLookup ?? false,
          url_lookup: entry.urlLookup ?? false,
        },
      });
      renderResult(body, resp);
    } catch (err) {
      body.innerHTML = "";
      const e = document.createElement("div");
      e.className = "enigma-popover-error";
      e.textContent =
        err instanceof Error ? err.message : "Verification failed.";
      body.appendChild(e);
    } finally {
      recheck.disabled = false;
    }
  }

  recheck.addEventListener("click", (e) => {
    e.stopPropagation();
    void run();
  });

  void run(); // immediate verify on open
}

type Rec = Record<string, unknown> | null | undefined;

function recStr(rec: Rec, key: string): string | null {
  const v = rec?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Clean display name for a provider (enum values are legacy labels). */
function cleanProvider(p: string): string {
  const s = (p || "").toLowerCase();
  if (s.startsWith("gpt")) return "GPT";
  if (s.startsWith("claude")) return "Claude";
  if (s.startsWith("gemini")) return "Gemini";
  if (s.startsWith("deepseek")) return "Deepseek";
  return p;
}

/** A copyable full canonical-citation block. */
function fullCitationBlock(citation: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "enigma-cite-full";
  const head = document.createElement("div");
  head.className = "enigma-cite-full-head";
  const label = document.createElement("span");
  label.className = "enigma-cite-full-label";
  label.textContent = "Full citation";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "enigma-cite-copy";
  copy.textContent = "Copy";
  copy.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard
      ?.writeText(citation)
      .then(() => {
        copy.textContent = "Copied ✓";
        setTimeout(() => {
          copy.textContent = "Copy";
        }, 1500);
      })
      .catch(() => {});
  });
  head.appendChild(label);
  head.appendChild(copy);
  const text = document.createElement("div");
  text.className = "enigma-cite-full-text";
  text.textContent = citation;
  wrap.appendChild(head);
  wrap.appendChild(text);
  return wrap;
}

function renderResult(body: HTMLElement, resp: VerifyCitationResponse): void {
  body.innerHTML = "";

  const chip = document.createElement("div");
  chip.className = `enigma-popover-verdict ${verdictClass(resp.verdict)}`;
  chip.textContent = verdictLabel(resp.verdict, resp.confidence);
  body.appendChild(chip);

  if (resp.explanation) {
    const ex = document.createElement("p");
    ex.className = "enigma-popover-explanation";
    ex.textContent = resp.explanation;
    body.appendChild(ex);
  }

  // Surface what the AI panel actually said, so "use AI" shows real substance
  // (not just a bare verdict) — including when the input isn't a checkable claim.
  if (resp.multi_llm) {
    const answered = resp.multi_llm.responses.filter(
      (r) => r.reasoning && !r.reasoning.startsWith("Provider error"),
    );
    if (answered.length > 0) {
      const panel = document.createElement("div");
      panel.className = "enigma-ai-panel";
      panel.appendChild(
        Object.assign(document.createElement("div"), {
          className: "enigma-ai-panel-title",
          textContent: "AI cross-check",
        }),
      );
      for (const r of answered) {
        const row = document.createElement("div");
        row.className = "enigma-ai-row";
        row.appendChild(
          Object.assign(document.createElement("span"), {
            className: "enigma-ai-who",
            textContent: `${cleanProvider(r.provider)} · ${r.verdict}`,
          }),
        );
        row.appendChild(
          Object.assign(document.createElement("div"), {
            className: "enigma-ai-why",
            textContent: r.stated_value || r.reasoning || "",
          }),
        );
        panel.appendChild(row);
      }
      body.appendChild(panel);
    }
  }

  if (resp.citations_found.length > 0) {
    const caption = document.createElement("div");
    caption.className = "enigma-cite-caption";
    caption.textContent =
      "Confirm this is the source the AI cited — a DOI can be real but point to a different paper:";
    body.appendChild(caption);

    for (const c of resp.citations_found) {
      body.appendChild(renderCitationCard(c));
    }
  }

  if (resp.methods) body.appendChild(renderMethods(resp.methods));
}

/** Show what was decided by deterministic algorithm vs the AI layer. */
function renderMethods(m: VerifyMethods): HTMLElement {
  const box = document.createElement("div");
  box.className = "enigma-methods";
  box.appendChild(
    Object.assign(document.createElement("div"), {
      className: "enigma-methods-title",
      textContent: "How this was checked",
    }),
  );

  const algo = document.createElement("div");
  algo.className = "enigma-method-row enigma-method-algo";
  algo.appendChild(
    Object.assign(document.createElement("span"), {
      className: "enigma-method-tag",
      textContent: "ALGORITHM",
    }),
  );
  algo.appendChild(
    Object.assign(document.createElement("span"), {
      className: "enigma-method-desc",
      textContent:
        m.citation_lookup && m.sources_queried.length
          ? "Authoritative database lookup · " + m.sources_queried.join(", ")
          : "ENIGMA logic",
    }),
  );
  box.appendChild(algo);

  const ai = document.createElement("div");
  ai.className =
    "enigma-method-row " + (m.llm_cross_check ? "enigma-method-ai" : "enigma-method-off");
  ai.appendChild(
    Object.assign(document.createElement("span"), {
      className: "enigma-method-tag",
      textContent: "AI",
    }),
  );
  ai.appendChild(
    Object.assign(document.createElement("span"), {
      className: "enigma-method-desc",
      textContent: m.llm_cross_check
        ? "Independent cross-check · " + (m.llm_providers.join(", ") || "panel")
        : "Not used — verified by algorithm",
    }),
  );
  box.appendChild(ai);

  return box;
}

function renderCitationCard(c: VerifyCitationResponse["citations_found"][number]): HTMLElement {
  const rec = c.verification.matched_record as Rec;

  const card = document.createElement("div");
  card.className = "enigma-cite-card";

  // Head: status + cited identifier + which source matched
  const head = document.createElement("div");
  head.className = "enigma-cite-head";
  const status = document.createElement("span");
  status.className = `enigma-cite-status ${c.verification.exists ? "ok" : "bad"}`;
  status.textContent = c.verification.exists ? "✓" : "✗";
  const id = document.createElement("code");
  id.className = "enigma-cite-id";
  id.textContent = c.citation.citation_text;
  head.appendChild(status);
  head.appendChild(id);
  if (c.verification.matched_source) {
    const src = document.createElement("span");
    src.className = "enigma-cite-source";
    src.textContent = `via ${c.verification.matched_source}`;
    head.appendChild(src);
  }
  card.appendChild(head);

  if (rec) {
    const title = recStr(rec, "title");
    if (title) {
      const t = document.createElement("div");
      t.className = "enigma-cite-title";
      t.textContent = title;
      card.appendChild(t);
    }

    const authorsRaw = rec["authors"];
    if (Array.isArray(authorsRaw) && authorsRaw.length > 0) {
      const a = document.createElement("div");
      a.className = "enigma-cite-meta";
      const names = authorsRaw.slice(0, 10).map((x) => String(x));
      a.textContent =
        names.join(", ") + (authorsRaw.length > 10 ? ", et al." : "");
      card.appendChild(a);
    }

    const metaBits: string[] = [];
    const year = rec["year"];
    if (typeof year === "number" || typeof year === "string") {
      metaBits.push(String(year));
    }
    const journal = recStr(rec, "journal");
    if (journal) metaBits.push(journal);
    const publisher = recStr(rec, "publisher");
    if (publisher) metaBits.push(publisher);
    const type = recStr(rec, "type");
    if (type) metaBits.push(type);
    if (metaBits.length > 0) {
      const m = document.createElement("div");
      m.className = "enigma-cite-meta";
      m.textContent = metaBits.join(" · ");
      card.appendChild(m);
    }

    const cites = rec["citation_count"];
    if (typeof cites === "number") {
      const cc = document.createElement("div");
      cc.className = "enigma-cite-meta";
      cc.textContent = `Cited by ${cites}`;
      card.appendChild(cc);
    }

    const full = recStr(rec, "formatted_citation");
    if (full) card.appendChild(fullCitationBlock(full));

    const doi = recStr(rec, "doi");
    const url = recStr(rec, "url") ?? (doi ? `https://doi.org/${doi}` : null);
    if (url) {
      const link = document.createElement("a");
      link.className = "enigma-cite-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open source →";
      card.appendChild(link);
    }
  } else if (c.verification.note) {
    const note = document.createElement("div");
    note.className = "enigma-cite-meta";
    note.textContent = c.verification.note;
    card.appendChild(note);
  } else if (!c.verification.exists) {
    const miss = document.createElement("div");
    miss.className = "enigma-cite-meta";
    miss.textContent = "Not found in authoritative sources.";
    card.appendChild(miss);
  }

  return card;
}

// ───────────────────────────────────────────────────────────────────
// Goal trees (#6) — same hierarchy as the toolbar popup, shown inside the
// on-page working window so you can build/track goals without leaving the page.
// Talks to /api/goals via the background (anon owner, or signed-in account).
// ───────────────────────────────────────────────────────────────────

function goalsRequest(
  op: "list" | "create" | "setStatus" | "claim" | "decompose",
  extra: {
    goalText?: string;
    parentId?: string | null;
    id?: string;
    status?: string;
    domain?: string;
  } = {},
): Promise<{
  ok: boolean;
  items?: GoalNode[];
  id?: string | null;
  claimed?: number;
  decomposition?: GoalDecomposition;
  error?: string;
}> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "GOALS_REQUEST", op, ...extra },
        (
          resp:
            | {
                type?: string;
                ok?: boolean;
                items?: GoalNode[];
                id?: string | null;
                claimed?: number;
                decomposition?: GoalDecomposition;
                error?: string;
              }
            | undefined,
        ) => {
          if (
            chrome.runtime.lastError ||
            !resp ||
            resp.type !== "GOALS_RESPONSE"
          ) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError?.message ?? "No response",
            });
          } else {
            resolve({
              ok: Boolean(resp.ok),
              items: resp.items,
              id: resp.id,
              claimed: resp.claimed,
              decomposition: resp.decomposition,
              error: resp.error,
            });
          }
        },
      );
    } catch {
      resolve({ ok: false, error: "messaging unavailable" });
    }
  });
}

function decompLabel(verdict: string | undefined): string {
  if (verdict === "covered") return "Sufficient";
  if (verdict === "under_covered") return "Under-covered";
  if (verdict === "partial") return "Partial";
  return "Estimate";
}

const GOAL_CYCLE = ["open", "satisfied", "failed"];

function goalStatusIcon(s: string): string {
  if (s === "satisfied") return "✓";
  if (s === "failed") return "✕";
  if (s === "pending") return "…";
  return "○";
}
function goalStatusClass(s: string): string {
  return ["open", "satisfied", "failed", "pending"].includes(s)
    ? `enigma-goal-${s}`
    : "enigma-goal-open";
}

/** A "Goal trees" section (expandable tree + add) for the on-page window. */
function buildGoalsSection(): HTMLElement {
  const sec = mk("div", "enigma-window-section");
  sec.appendChild(mk("div", "enigma-window-h", "Goal trees"));
  sec.appendChild(
    mk(
      "div",
      "enigma-window-sub",
      "Break a goal into subgoals. Saved here; moves to your account on sign-in.",
    ),
  );

  const tree = mk("div", "enigma-goal-tree");
  tree.appendChild(mk("div", "enigma-goal-loading", "Loading…"));
  sec.appendChild(tree);

  const addRow = mk("div", "enigma-goal-addrow");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "enigma-goal-input";
  input.placeholder = "New goal…";
  const addBtn = mk("button", "enigma-goal-addbtn", "Add") as HTMLButtonElement;
  addBtn.type = "button";
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  sec.appendChild(addRow);

  let goals: GoalNode[] = [];
  const expanded = new Set<string>();

  const childrenOf = (pid: string | null) =>
    goals.filter((g) => (g.parent_id ?? null) === pid);

  function showSubInput(wrap: HTMLElement, node: GoalNode, depth: number): void {
    if (wrap.querySelector(":scope > .enigma-goal-subinput")) return;
    const row = mk("div", "enigma-goal-subinput");
    row.style.paddingLeft = `${(depth + 1) * 14}px`;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "enigma-goal-input";
    inp.placeholder = "Subgoal…";
    const ok = mk("button", "enigma-goal-addbtn", "Add") as HTMLButtonElement;
    ok.type = "button";
    const submit = async (): Promise<void> => {
      const t = inp.value.trim();
      if (!t) return;
      expanded.add(node.id);
      const r = await goalsRequest("create", { goalText: t, parentId: node.id });
      if (r.ok) await reload();
    };
    ok.addEventListener("click", (e) => {
      e.stopPropagation();
      void submit();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submit();
      else if (e.key === "Escape") row.remove();
    });
    row.appendChild(inp);
    row.appendChild(ok);
    wrap.insertBefore(row, wrap.children[1] ?? null);
    inp.focus();
  }

  async function showDecompose(
    wrap: HTMLElement,
    node: GoalNode,
    depth: number,
  ): Promise<void> {
    if (wrap.querySelector(":scope > .enigma-goal-decomp")) return;
    const panel = mk("div", "enigma-goal-decomp");
    panel.style.marginLeft = `${(depth + 1) * 14}px`;
    panel.appendChild(
      mk("div", "enigma-goal-decomp-loading", "Decomposing with AI… (~10-30s)"),
    );
    wrap.insertBefore(panel, wrap.children[1] ?? null);

    const r = await goalsRequest("decompose", { goalText: node.goal_text });
    panel.innerHTML = "";
    const d = r.ok ? r.decomposition : undefined;
    if (!d || !d.available || !d.subgoals || !d.subgoals.length) {
      panel.appendChild(
        mk(
          "div",
          "enigma-goal-decomp-err",
          (d && d.error) || r.error || "Unavailable",
        ),
      );
      const close = mk(
        "button",
        "enigma-goal-cancelbtn",
        "Close",
      ) as HTMLButtonElement;
      close.type = "button";
      close.addEventListener("click", () => panel.remove());
      panel.appendChild(close);
      return;
    }
    const head = mk("div", "enigma-goal-decomp-head");
    head.appendChild(
      mk(
        "span",
        `enigma-goal-cov enigma-goal-cov-${d.verdict || "unknown"}`,
        decompLabel(d.verdict),
      ),
    );
    if (typeof d.coverage === "number") {
      head.appendChild(
        mk(
          "span",
          "enigma-goal-decomp-cov",
          `${Math.round(d.coverage * 100)}% coverage (estimate)`,
        ),
      );
    }
    panel.appendChild(head);
    if (d.coverage_note) {
      panel.appendChild(mk("div", "enigma-goal-decomp-note", d.coverage_note));
    }
    const list = mk("div", "enigma-goal-decomp-list");
    for (const sg of d.subgoals) {
      list.appendChild(mk("div", "enigma-goal-decomp-item", `• ${sg.text}`));
    }
    panel.appendChild(list);
    if (d.missing && d.missing.length) {
      panel.appendChild(
        mk("div", "enigma-goal-decomp-gap", `Gap: ${d.missing.join("; ")}`),
      );
    }
    const actions = mk("div", "enigma-goal-decomp-actions");
    const subs = d.subgoals;
    const add = mk(
      "button",
      "enigma-goal-addbtn",
      `Add ${subs.length} subgoals`,
    ) as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      add.disabled = true;
      add.textContent = "Adding…";
      void (async () => {
        for (const sg of subs) {
          await goalsRequest("create", {
            goalText: sg.text,
            parentId: node.id,
          });
        }
        expanded.add(node.id);
        panel.remove();
        await reload();
      })();
    });
    const cancel = mk(
      "button",
      "enigma-goal-cancelbtn",
      "Cancel",
    ) as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => panel.remove());
    actions.appendChild(add);
    actions.appendChild(cancel);
    panel.appendChild(actions);
  }

  function renderNode(node: GoalNode, depth: number): HTMLElement {
    const wrap = document.createElement("div");
    const row = mk("div", "enigma-goal-row");
    row.style.paddingLeft = `${depth * 14}px`;
    const kids = childrenOf(node.id);
    if (kids.length > 0) {
      const caret = mk(
        "button",
        "enigma-goal-caret",
        expanded.has(node.id) ? "▾" : "▸",
      ) as HTMLButtonElement;
      caret.type = "button";
      caret.addEventListener("click", (e) => {
        e.stopPropagation();
        if (expanded.has(node.id)) expanded.delete(node.id);
        else expanded.add(node.id);
        renderTree();
      });
      row.appendChild(caret);
    } else {
      row.appendChild(mk("span", "enigma-goal-caret-spacer"));
    }
    const chip = mk(
      "button",
      `enigma-goal-status ${goalStatusClass(node.status)}`,
      goalStatusIcon(node.status),
    ) as HTMLButtonElement;
    chip.type = "button";
    chip.title = node.status;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = GOAL_CYCLE.indexOf(node.status);
      const next = GOAL_CYCLE[(idx + 1) % GOAL_CYCLE.length] ?? "open";
      node.status = next;
      renderTree();
      void (async () => {
        const r = await goalsRequest("setStatus", { id: node.id, status: next });
        if (!r.ok) await reload();
      })();
    });
    row.appendChild(chip);
    const text = mk(
      "span",
      `enigma-goal-text${node.status === "satisfied" ? " enigma-goal-done" : ""}`,
      node.goal_text,
    );
    text.title = node.goal_text;
    row.appendChild(text);
    const eBtn = mk("button", "enigma-goal-e", "E") as HTMLButtonElement;
    eBtn.type = "button";
    eBtn.title = "Break into subgoals with AI (E)";
    eBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void showDecompose(wrap, node, depth);
    });
    row.appendChild(eBtn);
    const plus = mk("button", "enigma-goal-add", "＋") as HTMLButtonElement;
    plus.type = "button";
    plus.title = "Add subgoal";
    plus.addEventListener("click", (e) => {
      e.stopPropagation();
      showSubInput(wrap, node, depth);
    });
    row.appendChild(plus);
    wrap.appendChild(row);
    if (expanded.has(node.id)) {
      for (const k of kids) wrap.appendChild(renderNode(k, depth + 1));
    }
    return wrap;
  }

  function renderTree(): void {
    tree.innerHTML = "";
    const roots = childrenOf(null);
    if (roots.length === 0) {
      const wrap = mk("div", "enigma-goal-emptywrap");
      wrap.appendChild(
        mk(
          "div",
          "enigma-goal-empty",
          "Start with a ready set of life goals — then edit, add, or remove any:",
        ),
      );
      const list = mk("div", "enigma-goal-presets");
      for (const p of GOAL_PRESETS) {
        list.appendChild(
          mk(
            "div",
            "enigma-goal-preset",
            `• ${p.goal} (${p.subgoals.length} subgoals)`,
          ),
        );
      }
      wrap.appendChild(list);
      const seed = mk(
        "button",
        "enigma-goal-addbtn enigma-goal-seed",
        "Add starter goals",
      ) as HTMLButtonElement;
      seed.type = "button";
      seed.addEventListener("click", (e) => {
        e.stopPropagation();
        seed.disabled = true;
        seed.textContent = "Adding…";
        void (async () => {
          await seedPresetGoals(async (text, parent) => {
            const r = await goalsRequest("create", {
              goalText: text,
              parentId: parent,
            });
            return r.ok ? (r.id ?? null) : null;
          });
          await reload();
        })();
      });
      wrap.appendChild(seed);
      tree.appendChild(wrap);
      return;
    }
    for (const r of roots) tree.appendChild(renderNode(r, 0));
  }

  async function reload(): Promise<void> {
    const r = await goalsRequest("list");
    const items = r.ok && r.items ? r.items : [];
    // First run: auto-add the starter presets once so the tree isn't empty.
    if (r.ok && items.length === 0) {
      const s = await loadSettings();
      if (!s.goalsSeeded) {
        await saveSettings({ goalsSeeded: true });
        await seedPresetGoals(async (text, parent) => {
          const rr = await goalsRequest("create", {
            goalText: text,
            parentId: parent,
          });
          return rr.ok ? (rr.id ?? null) : null;
        });
        const r2 = await goalsRequest("list");
        goals = r2.ok && r2.items ? r2.items : [];
        renderTree();
        return;
      }
    }
    goals = items;
    renderTree();
  }

  const addRoot = async (): Promise<void> => {
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    const r = await goalsRequest("create", { goalText: t });
    if (r.ok) await reload();
  };
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void addRoot();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void addRoot();
  });

  void reload();
  return sec;
}

// ───────────────────────────────────────────────────────────────────
// Working window (#4): an icon at the end of every answer opens a panel that
// (A) verifies the answer's citations with the ALGORITHM ONLY (no LLM, no
// credits), and (B) lets the user paste their own DOI/reference/claim and
// choose "algorithm only" (default, free) or "use AI cross-check" (a credit).
// ───────────────────────────────────────────────────────────────────

const ANSWER_BTN_ATTR = "data-enigma-answer-btn";
const WINDOW_MAX_CHARS = 50000;
let activeWindow: HTMLElement | null = null;

function mk(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function closeWindow(): void {
  activeWindow?.remove();
  activeWindow = null;
  document.removeEventListener("keydown", onWindowKey, true);
  document.removeEventListener("click", onWindowOutside, true);
}
function onWindowKey(e: KeyboardEvent): void {
  if (e.key === "Escape") closeWindow();
}
function onWindowOutside(e: MouseEvent): void {
  const t = e.target as Element | null;
  if (
    activeWindow &&
    !activeWindow.contains(t) &&
    !t?.closest?.(".enigma-answer-btn")
  ) {
    closeWindow();
  }
}

/** Append a "Verify with ENIGMA Axiom" button at the end of an answer. */
export function placeAnswerButton(
  messageEl: Element,
  verify: VerifyFn,
  platformName: string,
  getAnswerText: () => string,
): void {
  if (messageEl.querySelector(".enigma-answer-btn")) return; // already present
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "enigma-answer-btn";
  const url = getIconUrl();
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.className = "enigma-answer-btn-img";
    btn.appendChild(img);
  }
  btn.appendChild(mk("span", undefined, "Verify with ENIGMA Axiom"));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    openWorkingWindow(getAnswerText(), platformName, verify, btn);
  });
  messageEl.appendChild(btn);
  messageEl.setAttribute(ANSWER_BTN_ATTR, "1");
}

function openWorkingWindow(
  answerText: string,
  platformName: string,
  verify: VerifyFn,
  anchor: HTMLElement,
): void {
  closeWindow();
  const win = mk("div", "enigma-window");
  placeFloating(win, anchor, 460);

  const header = mk("div", "enigma-window-header");
  header.appendChild(mk("span", "enigma-window-title", "ENIGMA Axiom"));
  const account = mk("div", "enigma-popover-account");
  const close = mk("button", "enigma-window-close", "✕") as HTMLButtonElement;
  close.type = "button";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeWindow();
  });
  header.appendChild(account);
  header.appendChild(close);
  win.appendChild(header);

  // ── Section A: this answer's citations — algorithm only ──
  const secA = mk("div", "enigma-window-section");
  secA.appendChild(mk("div", "enigma-window-h", "Citations in this answer"));
  secA.appendChild(mk("div", "enigma-window-sub", "Checked by algorithm — no AI, no credits"));
  const aBody = mk("div", "enigma-window-body");
  aBody.appendChild(mk("div", "enigma-popover-loading", "Checking citations…"));
  secA.appendChild(aBody);
  win.appendChild(secA);

  // ── Section B: check it yourself ──
  const secB = mk("div", "enigma-window-section");
  secB.appendChild(mk("div", "enigma-window-h", "Check it yourself"));
  const ta = document.createElement("textarea");
  ta.className = "enigma-window-textarea";
  ta.rows = 3;
  ta.placeholder = "Paste a DOI, a full reference, or a claim to verify…";
  secB.appendChild(ta);

  const controls = mk("div", "enigma-window-controls");
  const aiLabel = mk("label", "enigma-window-check");
  aiLabel.title = "Sign in (ENIGMA Axiom popup) to use the AI cross-check";
  const aiBox = document.createElement("input");
  aiBox.type = "checkbox";
  aiBox.disabled = true; // enabled async once we confirm the user is signed in
  const aiText = mk("span", undefined, "Use AI cross-check — sign in");
  aiLabel.appendChild(aiBox);
  aiLabel.appendChild(aiText);
  controls.appendChild(aiLabel);

  // Reflect sign-in: account chip + enable the AI cross-check for signed-in users.
  void getAuth().then(({ signedIn, user }) => {
    const chip = accountChip(user);
    if (chip) account.appendChild(chip);
    if (signedIn) {
      aiBox.disabled = false;
      aiText.textContent = "Use AI cross-check (1 credit)";
      aiLabel.title = "Run an independent AI cross-check";
    }
  });
  const sel = document.createElement("select");
  sel.className = "enigma-window-select";
  for (const c of CATEGORIES) {
    const o = document.createElement("option");
    o.value = c.domain;
    o.textContent = c.label;
    sel.appendChild(o);
  }
  controls.appendChild(sel);
  secB.appendChild(controls);

  const note = document.createElement("input");
  note.type = "text";
  note.className = "enigma-window-note";
  note.placeholder = "Optional note / context";
  secB.appendChild(note);

  const go = mk("button", "enigma-window-go", "Verify") as HTMLButtonElement;
  go.type = "button";
  secB.appendChild(go);
  const bBody = mk("div", "enigma-window-body");
  secB.appendChild(bBody);
  win.appendChild(secB);

  // ── Section C: goal trees (same hierarchy as the toolbar popup) ──
  win.appendChild(buildGoalsSection());

  const footer = mk("div", "enigma-window-footer");
  footer.appendChild(mk("span", undefined, "Default = algorithm only (free)"));
  const reg = document.createElement("a");
  reg.className = "enigma-popover-register";
  reg.href = REGISTER_URL;
  reg.target = "_blank";
  reg.rel = "noopener noreferrer";
  reg.textContent = "Get credits →";
  footer.appendChild(reg);
  win.appendChild(footer);

  document.body.appendChild(win);
  activeWindow = win;
  setTimeout(() => {
    document.addEventListener("click", onWindowOutside, true);
    document.addEventListener("keydown", onWindowKey, true);
  }, 0);

  // Section A — algorithm only (never calls the LLM).
  void (async () => {
    try {
      const resp = await verify({
        claim_text: answerText.slice(0, WINDOW_MAX_CHARS),
        context: `${platformName} answer`,
        options: {
          include_multi_llm_check: false,
          verify_citations: true,
          return_explanation: true,
        },
      });
      aBody.innerHTML = "";
      if (!resp.citations_found.length) {
        aBody.appendChild(
          mk(
            "div",
            "enigma-window-sub",
            "No verifiable citations (DOI, arXiv, PubMed ID, case law) found in this answer.",
          ),
        );
      } else {
        renderResult(aBody, resp);
      }
    } catch (err) {
      aBody.innerHTML = "";
      aBody.appendChild(
        mk(
          "div",
          "enigma-popover-error",
          err instanceof Error ? err.message : "Check failed.",
        ),
      );
    }
  })();

  // Section B — manual verify; LLM only if the user opts in.
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    const useLLM = aiBox.checked;
    const domain = (sel.value || null) as Domain | null;
    const hint = note.value.trim();
    bBody.innerHTML = "";
    bBody.appendChild(
      mk(
        "div",
        "enigma-popover-loading",
        useLLM ? "Verifying with AI cross-check…" : "Verifying (algorithm)…",
      ),
    );
    go.disabled = true;
    void (async () => {
      try {
        const resp = await verify({
          claim_text: text.slice(0, WINDOW_MAX_CHARS),
          context: hint ? `${platformName} — ${hint}` : `${platformName} manual check`,
          domain,
          options: {
            include_multi_llm_check: useLLM,
            verify_citations: true,
            return_explanation: true,
            force_claim_check: useLLM,
          },
        });
        bBody.innerHTML = "";
        renderResult(bBody, resp);
      } catch (err) {
        bBody.innerHTML = "";
        bBody.appendChild(
          mk(
            "div",
            "enigma-popover-error",
            err instanceof Error ? err.message : "Verification failed.",
          ),
        );
      } finally {
        go.disabled = false;
      }
    })();
  });
}
