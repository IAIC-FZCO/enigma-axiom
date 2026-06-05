/**
 * chrome.storage.local helpers — typed settings + safe defaults.
 *
 * Shared between background, content scripts, and the popup.
 */

import { DEFAULT_SETTINGS, type ExtensionSettings } from "./types";

const SETTINGS_KEY = "enigma_settings";

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const updated: ExtensionSettings = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}

export async function resetSettings(): Promise<ExtensionSettings> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

export async function isPrivacyAcknowledged(): Promise<boolean> {
  const s = await loadSettings();
  return s.privacyAcknowledgedAt !== null;
}

export async function acknowledgePrivacy(): Promise<void> {
  await saveSettings({ privacyAcknowledgedAt: new Date().toISOString() });
}

/**
 * Stable anonymous owner token for goal trees built before sign-in. Lazily
 * generated and persisted; on sign-in the background claims these trees into the
 * account (POST /api/goals/claim) and clears it.
 */
export async function getOrCreateAnonId(): Promise<string> {
  const s = await loadSettings();
  if (s.anonId) return s.anonId;
  const anonId = crypto.randomUUID();
  await saveSettings({ anonId });
  return anonId;
}
