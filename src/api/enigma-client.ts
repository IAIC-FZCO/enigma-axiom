/**
 * HTTP client for the ENIGMA Axiom API.
 *
 * Used from the background service worker — content scripts post messages
 * to the background which calls this client. This keeps API tokens out of
 * page-injected code.
 */

import type {
  ExtensionSettings,
  GoalDecomposition,
  GoalNode,
  MemoryItem,
  VerifyCitationRequest,
  VerifyCitationResponse,
} from "../types";

export class EnigmaApiClient {
  constructor(private settings: ExtensionSettings) {}

  /** Authed JSON request to the API (sends the SSO Bearer token). */
  private async authed<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-ENIGMA-Client": "chrome-extension/0.1.0",
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (this.settings.authToken) {
      headers["Authorization"] = `Bearer ${this.settings.authToken}`;
    }
    const resp = await fetch(`${this.settings.apiBaseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!resp.ok) {
      throw new Error(`${resp.status} ${resp.statusText}`);
    }
    return (await resp.json()) as T;
  }

  getMemorySettings(): Promise<{ memory_enabled: boolean }> {
    return this.authed("/api/memory/settings");
  }
  setMemorySettings(enabled: boolean): Promise<{ memory_enabled: boolean }> {
    return this.authed("/api/memory/settings", {
      method: "PUT",
      body: JSON.stringify({ memory_enabled: enabled }),
    });
  }
  listMemory(): Promise<{ items: MemoryItem[]; count: number }> {
    return this.authed("/api/memory");
  }
  deleteMemory(id: string): Promise<{ deleted: number }> {
    return this.authed(`/api/memory/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  wipeMemory(): Promise<{ deleted: number }> {
    return this.authed("/api/memory", { method: "DELETE" });
  }
  getMemoryContext(): Promise<{ context: string }> {
    return this.authed("/api/memory/context");
  }

  // ── Goal trees (/api/goals) ──────────────────────────────────────
  // Signed-in callers use the Bearer token; anonymous callers pass their
  // local owner token as a query param (?anon=…) — kept out of headers so it
  // never trips CORS preflight (the API allows GET/POST only).
  private ownerQuery(): string {
    if (this.settings.authToken) return "";
    return this.settings.anonId
      ? `?anon=${encodeURIComponent(this.settings.anonId)}`
      : "";
  }
  listGoals(): Promise<{ items: GoalNode[]; authenticated: boolean }> {
    return this.authed(`/api/goals${this.ownerQuery()}`);
  }
  createGoal(
    goalText: string,
    parentId?: string | null,
  ): Promise<{ id: string | null }> {
    const body: Record<string, unknown> = { goal_text: goalText };
    if (parentId) body.parent_id = parentId;
    return this.authed(`/api/goals${this.ownerQuery()}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  setGoalStatus(id: string, status: string): Promise<{ ok: boolean }> {
    return this.authed(`/api/goals/status${this.ownerQuery()}`, {
      method: "POST",
      body: JSON.stringify({ id, status }),
    });
  }
  claimGoals(): Promise<{ claimed: number }> {
    const anon = this.settings.anonId;
    if (!anon) return Promise.resolve({ claimed: 0 });
    return this.authed(`/api/goals/claim?anon=${encodeURIComponent(anon)}`, {
      method: "POST",
    });
  }
  decomposeGoal(
    goalText: string,
    domain?: string,
    existing?: string[],
  ): Promise<GoalDecomposition> {
    const body: Record<string, unknown> = { goal_text: goalText };
    if (domain) body.domain = domain;
    if (existing && existing.length) body.existing = existing;
    return this.authed(`/api/goals/decompose${this.ownerQuery()}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async verifyCitation(
    req: VerifyCitationRequest,
  ): Promise<VerifyCitationResponse> {
    const url = `${this.settings.apiBaseUrl}/api/verify/citation`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-ENIGMA-Client": "chrome-extension/0.1.0",
    };
    if (this.settings.authToken) {
      headers["Authorization"] = `Bearer ${this.settings.authToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Verify request failed: ${response.status} ${response.statusText}` +
            (await describeError(response)),
        );
      }

      return (await response.json()) as VerifyCitationResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Extract a human-readable reason from a failed response body. FastAPI returns
 * `{ detail: [...] }` for 422 validation errors and `{ detail: "..." }` for
 * most others. Returns a leading " — reason" string, or "" if nothing useful.
 */
async function describeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body?.detail;
    if (typeof detail === "string") return ` — ${detail}`;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === "object" ? (d as { msg?: string }).msg : null))
        .filter((m): m is string => Boolean(m));
      if (msgs.length > 0) return ` — ${msgs.join("; ")}`;
    }
    // 429 rate-limit (and similar) return a structured object detail.
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const d = detail as { message?: string; error?: string };
      if (d.message) return ` — ${d.message}`;
      if (d.error) return ` — ${d.error}`;
    }
  } catch {
    // Body was not JSON or already consumed — fall through.
  }
  return "";
}
