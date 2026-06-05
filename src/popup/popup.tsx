import React from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

import { PrivacyModal } from "./PrivacyModal";
import { MainPanel } from "./MainPanel";
import { loadSettings, isPrivacyAcknowledged } from "../storage";
import type { ExtensionSettings } from "../types";

function App() {
  const [settings, setSettings] = React.useState<ExtensionSettings | null>(null);
  const [acknowledged, setAcknowledged] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      const ack = await isPrivacyAcknowledged();
      setSettings(s);
      setAcknowledged(ack);
    })();
  }, []);

  if (settings === null || acknowledged === null) {
    return (
      <div className="p-4 text-gray-500 text-sm">Loading…</div>
    );
  }

  if (!acknowledged) {
    return (
      <PrivacyModal
        onAcknowledged={() => setAcknowledged(true)}
      />
    );
  }

  return <MainPanel settings={settings} onSettingsChange={setSettings} />;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
