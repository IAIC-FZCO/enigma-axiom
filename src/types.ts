/**
 * Shared TypeScript types — mirror Pydantic schemas from verify/app/models/schemas.py.
 *
 * If the backend schema changes, update this file and the corresponding
 * Python model in lockstep. Long-term we'll auto-generate from OpenAPI.
 */

export type Verdict = "true" | "false" | "uncertain" | "not_applicable";

export type Domain =
  | "academic"
  | "legal"
  | "medical"
  | "technical"
  | "financial"
  | "scientific"
  | "general";

export type CitationType =
  | "doi"
  | "arxiv_id"
  | "pmid"
  | "author_year"
  | "title"
  | "case_law_us"
  | "bib_ref"
  | "url"
  | "unknown";

export interface ExtractedCitation {
  citation_text: string;
  extracted_type: CitationType;
  normalized_id?: string | null;
  position_start?: number | null;
  position_end?: number | null;
}

export interface CitationVerification {
  exists: boolean;
  exists_confidence: number;
  queried_sources: string[];
  matched_source?: string | null;
  matched_record?: Record<string, unknown> | null;
  claim_match_score?: number | null;
  note?: string | null;
}

export interface CitationResult {
  citation: ExtractedCitation;
  verification: CitationVerification;
}

export interface LLMResponse {
  provider: string;
  verdict: Verdict;
  stated_value?: string | null;
  confidence: number;
  reasoning?: string | null;
  latency_ms: number;
}

export interface MultiLLMConsensus {
  responses: LLMResponse[];
  consensus_verdict: Verdict;
  agreement_score: number;
  actual_value_consensus?: string | null;
}

export interface PrivacyMetadata {
  recorded: boolean;
  retention_days: number;
  retention_policy_url: string;
  aggregated_to_stats: boolean;
}

export interface VerifyCitationRequest {
  claim_text: string;
  context?: string | null;
  domain?: Domain | null;
  options?: {
    include_multi_llm_check?: boolean;
    verify_citations?: boolean;
    return_explanation?: boolean;
    max_llm_providers?: number;
    // Run the LLM cross-check even when a citation already resolved (the
    // explicit "check the claim against the source" action). Off by default so
    // a plain citation lookup costs no LLM spend.
    force_claim_check?: boolean;
    // Treat claim_text as a bare reference TITLE (no DOI) and resolve it via
    // Crossref bibliographic search — confirms a real paper exists or flags a
    // likely-fabricated title. Set for linked/no-DOI references.
    title_lookup?: boolean;
    // Treat claim_text as a cited web URL: the server fetches the page, reads
    // its citation metadata, and verifies the recovered DOI/title. Set for
    // source links with no DOI in the URL (e.g. ChatGPT source pills).
    url_lookup?: boolean;
  };
}

export interface VerifyMethods {
  citation_lookup: boolean;
  sources_queried: string[];
  llm_cross_check: boolean;
  llm_providers: string[];
  note: string;
}

export interface VerifyCitationResponse {
  verdict: Verdict;
  confidence: number;
  domain: Domain;
  citations_found: CitationResult[];
  multi_llm: MultiLLMConsensus | null;
  methods?: VerifyMethods | null;
  explanation?: string | null;
  privacy: PrivacyMetadata;
  verification_time_ms: number;
  verified_at: string;
}

/**
 * The signed-in ENIGMA user, learned from enigma.ist's SSO session (see
 * background `REFRESH_AUTH`). Used to show "you're signed in" + gate the AI
 * cross-check (AI is for signed-in users).
 */
export interface AuthUser {
  name: string;
  username?: string;
  avatar?: string;
}

/** One item in the user's ENIGMA Memory (verified context they own). */
export interface MemoryItem {
  id: string;
  kind: string;
  content: string;
  source_title?: string | null;
  source_doi?: string | null;
  source_url?: string | null;
  verdict?: string | null;
  created_at?: string | null;
}

/** One node in the user's goal/task tree (6-tuple task; tree built via parent_id). */
export interface GoalNode {
  id: string;
  parent_id?: string | null;
  goal_text: string;
  status: string; // open | satisfied | failed | pending
  confidence?: number | null;
  scope?: string | null;
  created_at?: string | null;
}

/** Result of the "E" engine: an AI decomposition proposal + coverage estimate. */
export interface GoalDecomposition {
  available: boolean;
  subgoals?: { text: string; criterion?: string | null }[];
  coverage?: number | null; // 0..1 estimate
  coverage_note?: string | null;
  missing?: string[];
  verdict?: string; // covered | partial | under_covered | unknown
  method?: string; // e.g. "ai_estimate"
  error?: string;
}

/**
 * Messages between content script ↔ background service worker.
 */
export type RuntimeMessage =
  | {
      type: "VERIFY_REQUEST";
      id: string;
      payload: VerifyCitationRequest;
    }
  | {
      type: "VERIFY_RESPONSE";
      id: string;
      data: VerifyCitationResponse;
    }
  | {
      type: "VERIFY_ERROR";
      id: string;
      error: string;
    }
  | {
      type: "GET_AUTH_TOKEN";
    }
  | {
      type: "AUTH_TOKEN_RESPONSE";
      token: string | null;
    }
  | {
      type: "PRIVACY_ACKNOWLEDGED";
    }
  // Popup → content script: verify the latest assistant message on this page,
  // regardless of scroll position or whether auto-badging already ran.
  | {
      type: "VERIFY_LAST_REQUEST";
    }
  | {
      type: "VERIFY_LAST_RESULT";
      ok: boolean;
      verdict?: Verdict;
      confidence?: number;
      platform?: string;
      error?: string;
    }
  // Popup → background: re-read the enigma.ist SSO session (silent, via the
  // session cookie) and persist the token + profile to settings.
  | {
      type: "REFRESH_AUTH";
    }
  | {
      type: "AUTH_STATE";
      signedIn: boolean;
      user: AuthUser | null;
    }
  // ENIGMA Memory — popup/content ↔ background proxy to the authed /api/memory.
  | {
      type: "MEMORY_REQUEST";
      op: "getSettings" | "setSettings" | "list" | "delete" | "wipe" | "context";
      enabled?: boolean;
      id?: string;
    }
  | {
      type: "MEMORY_RESPONSE";
      ok: boolean;
      enabled?: boolean;
      items?: MemoryItem[];
      deleted?: number;
      context?: string;
      error?: string;
    }
  // Goal trees — popup ↔ background proxy to /api/goals (anon-friendly).
  | {
      type: "GOALS_REQUEST";
      op: "list" | "create" | "setStatus" | "claim" | "decompose";
      goalText?: string;
      parentId?: string | null;
      id?: string;
      status?: string;
      domain?: string;
      existing?: string[];
    }
  | {
      type: "GOALS_RESPONSE";
      ok: boolean;
      items?: GoalNode[];
      id?: string | null;
      claimed?: number;
      decomposition?: GoalDecomposition;
      error?: string;
    };

/**
 * Settings persisted via chrome.storage.local
 */
export interface ExtensionSettings {
  apiBaseUrl: string;
  authToken: string | null;
  user: AuthUser | null; // signed-in ENIGMA profile (from SSO), null if signed out
  anonId: string | null; // local anonymous owner token for goal trees (pre-sign-in)
  goalsSeeded: boolean; // starter goal presets were auto-added once (don't re-add)
  memoryEnabled: boolean; // mirror of the server-side Memory opt-in (UI gating only)
  privacyAcknowledgedAt: string | null; // ISO 8601 timestamp
  enabled: boolean;
  badgeVisibility: "always" | "uncertain_or_worse" | "false_only";
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: "https://api.enigma.ist",
  authToken: null,
  user: null,
  anonId: null,
  goalsSeeded: false,
  memoryEnabled: false,
  privacyAcknowledgedAt: null,
  enabled: true,
  badgeVisibility: "always",
};
