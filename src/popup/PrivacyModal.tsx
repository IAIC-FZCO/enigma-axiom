/**
 * First-run privacy disclosure modal.
 *
 * v5.3-compliant copy: explicitly states that verification records ARE
 * stored, with the retention duration depending on subscription tier.
 * No "zero retention" or "verification without surveillance" language.
 */

import React from "react";

interface Props {
  onAcknowledged: () => void;
}

export function PrivacyModal({ onAcknowledged }: Props) {
  const [acknowledging, setAcknowledging] = React.useState(false);

  async function handleAccept() {
    setAcknowledging(true);
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "PRIVACY_ACKNOWLEDGED" },
          () => {
            const err = chrome.runtime.lastError;
            if (err) {
              reject(new Error(err.message));
            } else {
              resolve();
            }
          },
        );
      });
      onAcknowledged();
    } catch (err) {
      console.error("Failed to record privacy acknowledgement", err);
      setAcknowledging(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-center gap-2">
        <span className="text-2xl">⚡</span>
        <div>
          <h1 className="font-semibold text-base text-gray-900">
            ENIGMA Axiom
          </h1>
          <p className="text-xs text-gray-500">Catch the citations LLMs invent.</p>
        </div>
      </header>

      <section className="space-y-2 text-sm text-gray-700">
        <p>
          ENIGMA Axiom checks ChatGPT, Claude, Gemini, and Deepseek responses
          against authoritative sources (Crossref, PubMed, CourtListener, OpenAlex)
          and cross-checks factual claims across multiple LLMs.
        </p>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Privacy at a glance
          </h2>
          <ul className="space-y-1 text-xs text-gray-700 list-disc pl-4">
            <li>
              Verification records (the AI response we checked, your context if any,
              and our verdict) are <strong>stored in our database</strong>.
            </li>
            <li>
              <strong>Retention by tier:</strong> Free / Personal — 30 days. Professional / Legal
              Pro — 90 days. Business — 90–180 days per DPA.
            </li>
            <li>Encrypted at rest. Never sold or shared with third parties.</li>
            <li>
              GDPR-compliant deletion on request from your account dashboard
              (or via{" "}
              <a
                href="mailto:privacy@enigma.ist"
                className="text-purple-600 underline"
              >
                privacy@enigma.ist
              </a>
              ).
            </li>
            <li>
              Anonymous aggregate statistics (claim types, LLM error patterns) may
              be published in our quarterly research reports — never linked to you.
            </li>
          </ul>
        </div>

        <p className="text-xs text-gray-500">
          See the full{" "}
          <a
            href="https://axiom.enigma.ist/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 underline"
          >
            Privacy Policy
          </a>{" "}
          and{" "}
          <a
            href="https://axiom.enigma.ist/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 underline"
          >
            Terms
          </a>
          .
        </p>
      </section>

      <button
        onClick={handleAccept}
        disabled={acknowledging}
        className="w-full rounded-md bg-purple-600 text-white font-medium py-2 disabled:opacity-60 disabled:cursor-not-allowed hover:bg-purple-700 transition"
      >
        {acknowledging ? "Saving…" : "I understand — let's start"}
      </button>
    </div>
  );
}
