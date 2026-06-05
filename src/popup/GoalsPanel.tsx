/**
 * Goal trees — build a hierarchy of goals/tasks that expand on click.
 *
 * Works signed-out (saved under a local anon token, persisted in this browser)
 * and is migrated into your account on sign-in (background REFRESH_AUTH →
 * POST /api/goals/claim). The tree is built client-side from each node's
 * parent_id. Clicking a node's status chip cycles open → satisfied → failed.
 */

import React from "react";

import type {
  ExtensionSettings,
  GoalDecomposition,
  GoalNode,
  RuntimeMessage,
} from "../types";
import { GOAL_PRESETS, seedPresetGoals } from "../goals-presets";
import { loadSettings, saveSettings } from "../storage";

/** Send a GOALS_REQUEST to the background and await the typed response. */
function goalsRequest(
  op: "list" | "create" | "setStatus" | "claim" | "decompose",
  extra: {
    goalText?: string;
    parentId?: string | null;
    id?: string;
    status?: string;
    domain?: string;
  } = {},
): Promise<Extract<RuntimeMessage, { type: "GOALS_RESPONSE" }>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "GOALS_REQUEST", op, ...extra },
      (resp?: RuntimeMessage) => {
        if (chrome.runtime.lastError || resp?.type !== "GOALS_RESPONSE") {
          resolve({
            type: "GOALS_RESPONSE",
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

const STATUS_CYCLE = ["open", "satisfied", "failed"] as const;

function statusChipClass(s: string): string {
  switch (s) {
    case "satisfied":
      return "bg-green-100 text-green-700";
    case "failed":
      return "bg-red-100 text-red-700";
    case "pending":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-gray-100 text-gray-500";
  }
}

function statusIcon(s: string): string {
  switch (s) {
    case "satisfied":
      return "✓";
    case "failed":
      return "✕";
    case "pending":
      return "…";
    default:
      return "○";
  }
}

function coverageLabel(d: GoalDecomposition): string {
  switch (d.verdict) {
    case "covered":
      return "Sufficient";
    case "under_covered":
      return "Under-covered";
    case "partial":
      return "Partial";
    default:
      return "Estimate";
  }
}
function coverageChipClass(d: GoalDecomposition): string {
  const base = "rounded px-1.5 py-0.5 font-semibold";
  switch (d.verdict) {
    case "covered":
      return `${base} bg-green-100 text-green-700`;
    case "under_covered":
      return `${base} bg-amber-100 text-amber-700`;
    default:
      return `${base} bg-gray-100 text-gray-600`;
  }
}

export function GoalsPanel({ settings }: { settings: ExtensionSettings }) {
  const [goals, setGoals] = React.useState<GoalNode[] | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [newRoot, setNewRoot] = React.useState("");
  const [addingSub, setAddingSub] = React.useState<string | null>(null);
  const [subText, setSubText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [decompFor, setDecompFor] = React.useState<string | null>(null);
  const [decompLoading, setDecompLoading] = React.useState(false);
  const [decompResult, setDecompResult] =
    React.useState<GoalDecomposition | null>(null);

  async function load() {
    const r = await goalsRequest("list");
    if (!r.ok) {
      setGoals([]);
      setError(r.error ?? "Failed to load goals");
      return;
    }
    const items = r.items ?? [];
    // First run: auto-add the starter presets once so the tree isn't empty.
    if (items.length === 0) {
      const s = await loadSettings();
      if (!s.goalsSeeded) {
        await saveSettings({ goalsSeeded: true });
        setSeeding(true);
        await seedPresetGoals(async (text, parent) => {
          const rr = await goalsRequest("create", {
            goalText: text,
            parentId: parent,
          });
          return rr.ok ? (rr.id ?? null) : null;
        });
        setSeeding(false);
        const r2 = await goalsRequest("list");
        setGoals(r2.ok && r2.items ? r2.items : []);
        setError(null);
        return;
      }
    }
    setGoals(items);
    setError(null);
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.authToken]);

  async function addGoal(text: string, parentId: string | null) {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const r = await goalsRequest("create", { goalText: t, parentId });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Failed to add goal");
      return;
    }
    if (parentId) {
      setExpanded((s) => new Set(s).add(parentId));
    }
    await load();
  }

  async function addStarter() {
    setSeeding(true);
    await seedPresetGoals(async (text, parent) => {
      const r = await goalsRequest("create", { goalText: text, parentId: parent });
      return r.ok ? (r.id ?? null) : null;
    });
    setSeeding(false);
    await load();
  }

  async function runDecompose(node: GoalNode) {
    setDecompFor(node.id);
    setDecompResult(null);
    setDecompLoading(true);
    const r = await goalsRequest("decompose", { goalText: node.goal_text });
    setDecompLoading(false);
    setDecompResult(
      r.ok && r.decomposition
        ? r.decomposition
        : { available: false, error: r.error ?? "Failed" },
    );
  }
  async function acceptDecompose(node: GoalNode) {
    const subs = decompResult?.subgoals ?? [];
    if (!subs.length) return;
    setBusy(true);
    for (const sg of subs) {
      await goalsRequest("create", { goalText: sg.text, parentId: node.id });
    }
    setBusy(false);
    setExpanded((s) => new Set(s).add(node.id));
    setDecompFor(null);
    setDecompResult(null);
    await load();
  }

  async function cycleStatus(node: GoalNode) {
    const idx = STATUS_CYCLE.indexOf(
      node.status as (typeof STATUS_CYCLE)[number],
    );
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] ?? "open";
    // optimistic
    setGoals((gs) =>
      gs ? gs.map((g) => (g.id === node.id ? { ...g, status: next } : g)) : gs,
    );
    const r = await goalsRequest("setStatus", { id: node.id, status: next });
    if (!r.ok) {
      setError(r.error ?? "Failed to update status");
      await load();
    }
  }

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const childrenOf = (pid: string | null) =>
    (goals ?? []).filter((g) => (g.parent_id ?? null) === pid);

  function renderNode(node: GoalNode, depth: number): React.ReactNode {
    const kids = childrenOf(node.id);
    const open = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-1 py-0.5"
          style={{ paddingLeft: depth * 14 }}
        >
          {kids.length > 0 ? (
            <button
              onClick={() => toggle(node.id)}
              className="w-4 shrink-0 text-gray-400 hover:text-gray-700"
              aria-label={open ? "Collapse" : "Expand"}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="inline-block w-4 shrink-0" />
          )}
          <button
            onClick={() => void cycleStatus(node)}
            title={node.status}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${statusChipClass(node.status)}`}
          >
            {statusIcon(node.status)}
          </button>
          <span
            className={`flex-1 truncate text-sm ${node.status === "satisfied" ? "text-gray-400 line-through" : "text-gray-800"}`}
            title={node.goal_text}
          >
            {node.goal_text}
          </span>
          <button
            onClick={() => void runDecompose(node)}
            title="Break into subgoals with AI (E)"
            className="shrink-0 px-1 text-[11px] font-bold text-purple-400 hover:text-purple-700"
          >
            E
          </button>
          <button
            onClick={() => {
              setAddingSub(node.id);
              setSubText("");
            }}
            title="Add subgoal"
            className="shrink-0 px-1 text-gray-300 hover:text-purple-600"
          >
            ＋
          </button>
        </div>
        {addingSub === node.id && (
          <div
            className="flex gap-1 py-1"
            style={{ paddingLeft: (depth + 1) * 14 }}
          >
            <input
              autoFocus
              value={subText}
              onChange={(e) => setSubText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void addGoal(subText, node.id);
                  setAddingSub(null);
                } else if (e.key === "Escape") {
                  setAddingSub(null);
                }
              }}
              placeholder="Subgoal…"
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
            />
            <button
              onClick={() => {
                void addGoal(subText, node.id);
                setAddingSub(null);
              }}
              className="rounded bg-purple-600 px-2 text-xs text-white"
            >
              Add
            </button>
          </div>
        )}
        {decompFor === node.id && (
          <div
            className="my-1 rounded border border-purple-200 bg-purple-50 p-2"
            style={{ marginLeft: (depth + 1) * 14 }}
          >
            {decompLoading ? (
              <p className="text-xs text-gray-500">
                Decomposing with AI… (~10–30s)
              </p>
            ) : decompResult &&
              decompResult.available &&
              decompResult.subgoals ? (
              <>
                <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                  <span className={coverageChipClass(decompResult)}>
                    {coverageLabel(decompResult)}
                  </span>
                  {typeof decompResult.coverage === "number" && (
                    <span className="text-gray-500">
                      {Math.round(decompResult.coverage * 100)}% coverage
                      (estimate)
                    </span>
                  )}
                </div>
                {decompResult.coverage_note && (
                  <p className="mb-1 text-[11px] text-gray-500">
                    {decompResult.coverage_note}
                  </p>
                )}
                <ul className="mb-1 space-y-0.5">
                  {decompResult.subgoals.map((sg, i) => (
                    <li key={i} className="text-xs text-gray-700">
                      • {sg.text}
                    </li>
                  ))}
                </ul>
                {decompResult.missing && decompResult.missing.length > 0 && (
                  <p className="mb-1 text-[11px] text-amber-700">
                    Gap: {decompResult.missing.join("; ")}
                  </p>
                )}
                <div className="flex gap-1">
                  <button
                    onClick={() => void acceptDecompose(node)}
                    disabled={busy}
                    className="rounded bg-purple-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Add {decompResult.subgoals.length} subgoals
                  </button>
                  <button
                    onClick={() => {
                      setDecompFor(null);
                      setDecompResult(null);
                    }}
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-red-600">
                  {decompResult?.error ?? "Unavailable"}
                </p>
                <button
                  onClick={() => {
                    setDecompFor(null);
                    setDecompResult(null);
                  }}
                  className="text-xs text-gray-400 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}
        {open && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf(null);

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        Goal trees
      </h2>
      {!settings.authToken && (
        <p className="text-xs text-gray-400">
          Saved to this browser. Sign in and they move to your account.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="max-h-56 overflow-auto rounded border border-gray-200 p-2">
        {goals === null ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : roots.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Start with a ready set of life goals — then edit, add, or remove
              any:
            </p>
            <ul className="space-y-0.5">
              {GOAL_PRESETS.map((p) => (
                <li key={p.goal} className="text-xs text-gray-600">
                  • {p.goal}{" "}
                  <span className="text-gray-400">
                    ({p.subgoals.length} subgoals)
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => void addStarter()}
              disabled={seeding}
              className="w-full rounded-md bg-purple-600 py-1.5 text-sm font-medium text-white transition hover:bg-purple-700 disabled:opacity-50"
            >
              {seeding ? "Adding…" : "Add starter goals"}
            </button>
          </div>
        ) : (
          roots.map((r) => renderNode(r, 0))
        )}
      </div>
      <div className="flex gap-1">
        <input
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void addGoal(newRoot, null);
              setNewRoot("");
            }
          }}
          placeholder="New goal…"
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => {
            void addGoal(newRoot, null);
            setNewRoot("");
          }}
          disabled={busy || !newRoot.trim()}
          className="rounded-md bg-purple-600 px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}
