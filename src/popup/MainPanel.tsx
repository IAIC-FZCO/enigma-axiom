/**
 * Main popup panel — shown after the user has acknowledged privacy disclosure.
 *
 * Phase 1 surface area:
 * - Enable / disable toggle
 * - Badge visibility selector
 * - Link to account dashboard (Phase 2 — disabled for now)
 * - Sign-in button (Phase 2 — Laravel SSO popup)
 * - Link to source code (open-source data handling layer)
 * - Privacy policy link
 */

import React from "react";

import { loadSettings, saveSettings } from "../storage";
import { HostedGoals } from "./HostedGoals";
import type {
  ExtensionSettings,
  MemoryItem,
  RuntimeMessage,
  Verdict,
} from "../types";

/** Send a MEMORY_REQUEST to the background and await the typed response. */
function memoryRequest(
  op: "getSettings" | "setSettings" | "list" | "delete" | "wipe",
  extra: { enabled?: boolean; id?: string } = {},
): Promise<Extract<RuntimeMessage, { type: "MEMORY_RESPONSE" }>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "MEMORY_REQUEST", op, ...extra },
      (resp?: RuntimeMessage) => {
        if (chrome.runtime.lastError || resp?.type !== "MEMORY_RESPONSE") {
          resolve({
            type: "MEMORY_RESPONSE",
            ok: false,
            error: chrome.runtime.lastError?.message ?? "No response",
          });
        } else {
          resolve(resp);
        }
      },
    );
  });
}

interface Props {
  settings: ExtensionSettings;
  onSettingsChange: (s: ExtensionSettings) => void;
}

type VerifyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; verdict: Verdict; confidence: number; platform?: string }
  | { status: "error"; message: string };

export function MainPanel({ settings, onSettingsChange }: Props) {
  const [verify, setVerify] = React.useState<VerifyState>({ status: "idle" });
  const [authBusy, setAuthBusy] = React.useState(false);

  async function update(patch: Partial<ExtensionSettings>) {
    const next = await saveSettings(patch);
    onSettingsChange(next);
  }

  /**
   * Ask the background to re-read the enigma.ist SSO session (silent, via the
   * session cookie) and pull the refreshed token + profile into settings.
   */
  async function refreshAuth() {
    setAuthBusy(true);
    try {
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: "REFRESH_AUTH" }, () => resolve());
      });
      onSettingsChange(await loadSettings());
    } catch {
      // ignore — leave whatever state we had
    } finally {
      setAuthBusy(false);
    }
  }

  const [memOn, setMemOn] = React.useState(settings.memoryEnabled);
  const [memItems, setMemItems] = React.useState<MemoryItem[] | null>(null);
  const [memBusy, setMemBusy] = React.useState(false);

  // On open, silently pick up an existing enigma.ist login, then Memory state.
  React.useEffect(() => {
    void (async () => {
      await refreshAuth();
      const s = await loadSettings();
      if (s.authToken) {
        const r = await memoryRequest("getSettings");
        if (r.ok && typeof r.enabled === "boolean") setMemOn(r.enabled);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleMemory(next: boolean) {
    setMemBusy(true);
    const r = await memoryRequest("setSettings", { enabled: next });
    if (r.ok && typeof r.enabled === "boolean") {
      setMemOn(r.enabled);
      onSettingsChange(await loadSettings());
    }
    setMemBusy(false);
  }
  async function loadMemItems() {
    const r = await memoryRequest("list");
    setMemItems(r.ok && r.items ? r.items : []);
  }
  async function deleteMemItem(id: string) {
    await memoryRequest("delete", { id });
    await loadMemItems();
  }
  async function wipeMem() {
    setMemBusy(true);
    await memoryRequest("wipe");
    await loadMemItems();
    setMemBusy(false);
  }

  /**
   * Manually verify the latest AI response on the active tab. Works from any
   * scroll position and regardless of whether auto-badging already ran.
   */
  async function verifyLastResponse() {
    setVerify({ status: "loading" });
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        setVerify({ status: "error", message: "No active tab found." });
        return;
      }
      const result = await new Promise<RuntimeMessage>((resolve, reject) => {
        chrome.tabs.sendMessage(
          tab.id!,
          { type: "VERIFY_LAST_REQUEST" },
          (resp?: RuntimeMessage) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) reject(new Error(lastError.message));
            else resolve(resp as RuntimeMessage);
          },
        );
      });
      if (result?.type === "VERIFY_LAST_RESULT" && result.ok) {
        setVerify({
          status: "done",
          verdict: result.verdict ?? "uncertain",
          confidence: result.confidence ?? 0,
          platform: result.platform,
        });
      } else if (result?.type === "VERIFY_LAST_RESULT") {
        setVerify({
          status: "error",
          message: result.error ?? "Verification failed.",
        });
      } else {
        setVerify({ status: "error", message: "Unexpected response." });
      }
    } catch {
      // Most common cause: the active tab is not a supported LLM site, so no
      // content script is listening.
      setVerify({
        status: "error",
        message:
          "Open or refresh a ChatGPT, Claude, Gemini, or Deepseek tab, then click Verify again.",
      });
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2">
        <span className="text-2xl">⚡</span>
        <div className="flex-1">
          <h1 className="font-semibold text-base text-gray-900">
            ENIGMA Axiom
          </h1>
          <p className="text-xs text-gray-500">v0.2.0 · {settings.apiBaseUrl}</p>
        </div>
        <Toggle
          enabled={settings.enabled}
          onChange={(enabled) => void update({ enabled })}
        />
      </header>

      <section className="space-y-2">
        <button
          onClick={() => void verifyLastResponse()}
          disabled={verify.status === "loading"}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verify.status === "loading" ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Verifying last response…
            </>
          ) : (
            <>⚡ Verify last AI response</>
          )}
        </button>
        {verify.status === "done" && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${verdictChipClass(verify.verdict)}`}
          >
            <span className="font-semibold">{verdictLabel(verify.verdict)}</span>{" "}
            ({Math.round(verify.confidence * 100)}%)
            {verify.platform ? (
              <span className="opacity-70"> · {verify.platform}</span>
            ) : null}
            <div className="mt-0.5 text-xs opacity-80">
              Badge added to the response on the page.
            </div>
          </div>
        )}
        {verify.status === "error" && (
          <p className="text-xs text-red-600">{verify.message}</p>
        )}
      </section>

      <section className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
          Show badges
        </label>
        <select
          value={settings.badgeVisibility}
          onChange={(e) =>
            void update({
              badgeVisibility: e.target.value as ExtensionSettings["badgeVisibility"],
            })
          }
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="always">On every AI response</option>
          <option value="uncertain_or_worse">
            Only when uncertain or false
          </option>
          <option value="false_only">Only when likely false</option>
        </select>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Account
        </h2>
        {settings.user ? (
          <div className="flex items-center gap-2">
            {settings.user.avatar ? (
              <img
                src={settings.user.avatar}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-sm font-semibold text-purple-700">
                {(settings.user.name || "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900">
                {settings.user.name || "Signed in"}
              </div>
              {settings.user.username ? (
                <div className="truncate text-xs text-gray-500">
                  @{settings.user.username}
                </div>
              ) : null}
            </div>
            <button
              onClick={() => void update({ authToken: null, user: null })}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <a
              href="https://enigma.ist/login"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-md bg-purple-600 py-1.5 text-center text-sm font-medium text-white hover:bg-purple-700"
            >
              Sign in with ENIGMA
            </a>
            <button
              onClick={() => void refreshAuth()}
              disabled={authBusy}
              className="w-full rounded-md border border-gray-300 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
            >
              {authBusy ? "Checking…" : "I've signed in — refresh"}
            </button>
            <p className="text-xs text-gray-500">
              Sign in to unlock the AI cross-check.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          ENIGMA Memory
        </h2>
        {settings.authToken ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-800">
                Build my knowledge memory
              </span>
              <Toggle enabled={memOn} onChange={(v) => void toggleMemory(v)} />
            </div>
            <p className="text-xs text-gray-500">
              Off by default. When on, ENIGMA saves the sources you verify and
              lets you add that verified context to your AI prompts (you choose,
              and you see exactly what's added). You own this data — view and
              delete it anytime. It's an aid, not a guarantee of accuracy and not
              professional advice; you remain responsible for how you use it.
            </p>
            <div>
              <button
                onClick={() => {
                  if (memItems === null) void loadMemItems();
                  else setMemItems(null);
                }}
                className="text-xs text-purple-600 underline"
              >
                {memItems === null ? "View saved memory" : "Hide"}
              </button>
            </div>
            {memItems !== null && (
              <div className="max-h-40 space-y-1 overflow-auto rounded border border-gray-200 p-2">
                {memItems.length === 0 ? (
                  <p className="text-xs text-gray-400">No saved items yet.</p>
                ) : (
                  <>
                    {memItems.map((it) => (
                      <div key={it.id} className="flex items-start gap-2 text-xs">
                        <span className="flex-1 text-gray-700">{it.content}</span>
                        <button
                          onClick={() => void deleteMemItem(it.id)}
                          className="text-red-500 hover:text-red-700"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => void wipeMem()}
                      disabled={memBusy}
                      className="mt-1 text-xs text-red-600 underline disabled:opacity-60"
                    >
                      Clear all
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-500">
            Sign in to enable ENIGMA Memory.
          </p>
        )}
      </section>

      <HostedGoals settings={settings} />

      <footer className="pt-2 border-t border-gray-200 text-xs text-gray-500 space-y-1">
        <p>
          <a
            href="https://axiom.enigma.ist/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 underline"
          >
            Privacy policy
          </a>
          {" · "}
          <a
            href="https://axiom.enigma.ist/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 underline"
          >
            Terms
          </a>
          {" · "}
          <a
            href="https://github.com/iaic-fzco/enigma-axiom"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 underline"
          >
            Source
          </a>
        </p>
        <p>© 2026 IAIC AI Research &amp; Trading FZCO</p>
      </footer>
    </div>
  );
}

function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
        enabled ? "bg-purple-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function verdictLabel(v: Verdict): string {
  switch (v) {
    case "true":
      return "Verified";
    case "false":
      return "Likely false";
    case "uncertain":
      return "Uncertain";
    default:
      return "Not verifiable";
  }
}

function verdictChipClass(v: Verdict): string {
  switch (v) {
    case "true":
      return "border border-green-200 bg-green-50 text-green-800";
    case "false":
      return "border border-red-200 bg-red-50 text-red-800";
    case "uncertain":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border border-gray-200 bg-gray-50 text-gray-700";
  }
}
