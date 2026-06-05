/**
 * Background service worker — bridges content scripts to the ENIGMA Axiom API.
 *
 * Content scripts inject UI into LLM chat pages and post VERIFY_REQUEST messages
 * here. We make the HTTP call (which keeps the API token out of page context)
 * and post the result back.
 *
 * Manifest V3 service workers can be evicted at any time — we keep state in
 * chrome.storage, not in module-level variables.
 */

import { EnigmaApiClient } from "./api/enigma-client";
import { loadSettings, acknowledgePrivacy, saveSettings } from "./storage";
import type { AuthUser, RuntimeMessage } from "./types";

// enigma.ist SSO "session → token" endpoint. We read it cross-origin with the
// session cookie (host_permission grants access; ordinary web pages can't read
// the response). If the user is logged into enigma.ist, it returns a JWT +
// profile; otherwise {token:null}.
const SSO_TOKEN_URL = "https://enigma.ist/sso/token";

/**
 * Re-read the enigma.ist SSO session and persist {authToken, user} to settings.
 * - 200 + token  → signed in (store token + profile).
 * - 200 + null   → server says logged out (clear stored auth).
 * - error / non-200 → leave stored state untouched (network blip shouldn't sign
 *   the user out); just report what we currently have.
 */
async function refreshAuth(): Promise<RuntimeMessage> {
  try {
    const resp = await fetch(SSO_TOKEN_URL, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        token?: string | null;
        name?: string;
        username?: string;
        avatar?: string;
      };
      if (data?.token) {
        const user: AuthUser = {
          name: data.name ?? "",
          username: data.username || undefined,
          avatar: data.avatar || undefined,
        };
        await saveSettings({ authToken: data.token, user });
        // Migrate any anonymous goal trees built before sign-in into the account.
        const after = await loadSettings();
        if (after.anonId) {
          try {
            await new EnigmaApiClient(after).claimGoals();
            await saveSettings({ anonId: null });
          } catch (e) {
            console.warn("[ENIGMA Axiom] goal claim failed:", e);
          }
        }
        return { type: "AUTH_STATE", signedIn: true, user };
      }
      // Server definitively reports no session — clear any stale auth.
      await saveSettings({ authToken: null, user: null });
      return { type: "AUTH_STATE", signedIn: false, user: null };
    }
  } catch (err) {
    console.warn("[ENIGMA Axiom] auth refresh failed:", err);
  }
  const s = await loadSettings();
  return { type: "AUTH_STATE", signedIn: Boolean(s.authToken), user: s.user };
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    console.info("[ENIGMA Axiom] Installed v0.2.0");
    // Open the popup on first install so the user can review the privacy modal
    await chrome.action.setBadgeText({ text: "NEW" });
    await chrome.action.setBadgeBackgroundColor({ color: "#7c6fe0" });
  }
});

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeMessage) => void,
  ): boolean => {
    void handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (message.type === "VERIFY_REQUEST") {
          sendResponse({
            type: "VERIFY_ERROR",
            id: message.id,
            error: errorMessage,
          });
        }
      });
    return true; // keep the message channel open for the async response
  },
);

/** Proxy ENIGMA Memory operations to the authed API (token stays in bg). */
async function handleMemory(
  message: Extract<RuntimeMessage, { type: "MEMORY_REQUEST" }>,
): Promise<RuntimeMessage> {
  try {
    const settings = await loadSettings();
    const client = new EnigmaApiClient(settings);
    switch (message.op) {
      case "getSettings": {
        const r = await client.getMemorySettings();
        await saveSettings({ memoryEnabled: r.memory_enabled });
        return { type: "MEMORY_RESPONSE", ok: true, enabled: r.memory_enabled };
      }
      case "setSettings": {
        const r = await client.setMemorySettings(Boolean(message.enabled));
        await saveSettings({ memoryEnabled: r.memory_enabled });
        return { type: "MEMORY_RESPONSE", ok: true, enabled: r.memory_enabled };
      }
      case "list": {
        const r = await client.listMemory();
        return { type: "MEMORY_RESPONSE", ok: true, items: r.items };
      }
      case "delete": {
        const r = await client.deleteMemory(message.id ?? "");
        return { type: "MEMORY_RESPONSE", ok: true, deleted: r.deleted };
      }
      case "wipe": {
        const r = await client.wipeMemory();
        return { type: "MEMORY_RESPONSE", ok: true, deleted: r.deleted };
      }
      case "context": {
        const r = await client.getMemoryContext();
        return { type: "MEMORY_RESPONSE", ok: true, context: r.context };
      }
      default:
        return { type: "MEMORY_RESPONSE", ok: false, error: "unknown op" };
    }
  } catch (err) {
    return {
      type: "MEMORY_RESPONSE",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Proxy goal-tree operations to /api/goals (token or anon owner stays in bg). */
async function handleGoals(
  message: Extract<RuntimeMessage, { type: "GOALS_REQUEST" }>,
): Promise<RuntimeMessage> {
  try {
    let settings = await loadSettings();
    // Anonymous users get a stable local owner token so their trees persist and
    // can later be claimed into an account on sign-in.
    if (!settings.authToken && !settings.anonId) {
      settings = await saveSettings({ anonId: crypto.randomUUID() });
    }
    const client = new EnigmaApiClient(settings);
    switch (message.op) {
      case "list": {
        const r = await client.listGoals();
        return { type: "GOALS_RESPONSE", ok: true, items: r.items };
      }
      case "create": {
        const r = await client.createGoal(
          message.goalText ?? "",
          message.parentId ?? null,
        );
        return { type: "GOALS_RESPONSE", ok: true, id: r.id };
      }
      case "setStatus": {
        const r = await client.setGoalStatus(
          message.id ?? "",
          message.status ?? "open",
        );
        return { type: "GOALS_RESPONSE", ok: Boolean(r.ok) };
      }
      case "claim": {
        const r = await client.claimGoals();
        return { type: "GOALS_RESPONSE", ok: true, claimed: r.claimed };
      }
      case "decompose": {
        const r = await client.decomposeGoal(
          message.goalText ?? "",
          message.domain,
          message.existing,
        );
        return { type: "GOALS_RESPONSE", ok: true, decomposition: r };
      }
      default:
        return { type: "GOALS_RESPONSE", ok: false, error: "unknown op" };
    }
  } catch (err) {
    return {
      type: "GOALS_RESPONSE",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleMessage(message: RuntimeMessage): Promise<RuntimeMessage> {
  switch (message.type) {
    case "VERIFY_REQUEST": {
      const settings = await loadSettings();
      const client = new EnigmaApiClient(settings);
      const data = await client.verifyCitation(message.payload);
      return { type: "VERIFY_RESPONSE", id: message.id, data };
    }
    case "GET_AUTH_TOKEN": {
      const settings = await loadSettings();
      return { type: "AUTH_TOKEN_RESPONSE", token: settings.authToken };
    }
    case "REFRESH_AUTH":
      return await refreshAuth();
    case "MEMORY_REQUEST":
      return await handleMemory(message);
    case "GOALS_REQUEST":
      return await handleGoals(message);
    case "PRIVACY_ACKNOWLEDGED": {
      await acknowledgePrivacy();
      await chrome.action.setBadgeText({ text: "" });
      return { type: "PRIVACY_ACKNOWLEDGED" };
    }
    default:
      return {
        type: "VERIFY_ERROR",
        id: "unknown",
        error: `Unknown message type: ${(message as { type: string }).type}`,
      };
  }
}
