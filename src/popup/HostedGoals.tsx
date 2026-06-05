/**
 * Hosted goal engine — embeds the web app at axiom.enigma.ist/app in the popup
 * via an iframe, and bridges the SSO token to it (postMessage). The web app
 * can't rely on third-party cookies for SSO inside an extension iframe, so the
 * popup (which already holds the token via REFRESH_AUTH) hands it over.
 *
 * This is the hosted-UI shell: the goal engine lives on the web and can be
 * updated without a Chrome Web Store re-review.
 */

import React from "react";

import type { ExtensionSettings } from "../types";

const APP_ORIGIN = "https://axiom.enigma.ist";
const APP_URL = `${APP_ORIGIN}/app/?ctx=ext`;

export function HostedGoals({ settings }: { settings: ExtensionSettings }) {
  const ref = React.useRef<HTMLIFrameElement>(null);

  const sendToken = React.useCallback(() => {
    const win = ref.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "ENIGMA_TOKEN",
        token: settings.authToken ?? null,
        user: settings.user ?? null,
      },
      APP_ORIGIN,
    );
  }, [settings.authToken, settings.user]);

  React.useEffect(() => {
    // The app posts ENIGMA_APP_READY once mounted; reply with the token.
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== APP_ORIGIN) return;
      if ((ev.data as { type?: string } | null)?.type === "ENIGMA_APP_READY") {
        sendToken();
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sendToken]);

  // Re-send whenever the token changes (e.g. after sign-in).
  React.useEffect(() => {
    sendToken();
  }, [sendToken]);

  return (
    <iframe
      ref={ref}
      src={APP_URL}
      title="ENIGMA Goals"
      onLoad={sendToken}
      style={{
        width: "100%",
        height: 420,
        border: "none",
        borderRadius: 8,
        background: "#060608",
      }}
    />
  );
}
