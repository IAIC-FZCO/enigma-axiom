/**
 * Hosted goal engine — embeds the web app at axiom.enigma.ist/app in the popup
 * via an iframe, and bridges the SSO token to it (postMessage). The web app
 * can't rely on third-party cookies for SSO inside an extension iframe, so the
 * popup (which already holds the token via REFRESH_AUTH) hands it over.
 *
 * This is the hosted-UI shell: the goal engine lives on the web and can be
 * updated without a Chrome Web Store re-review.
 *
 * Token handover is handshake-driven: we ONLY ever postMessage to the window we
 * captured from the app's own ENIGMA_APP_READY message. That window is
 * definitively at APP_ORIGIN. Posting to iframe.contentWindow before it has
 * navigated to axiom (on mount / onLoad of about:blank) throws
 * "target origin does not match the recipient window's origin", so we never do.
 */

import React from "react";

import type { ExtensionSettings } from "../types";

const APP_ORIGIN = "https://axiom.enigma.ist";
const APP_URL = `${APP_ORIGIN}/app/?ctx=ext`;

export function HostedGoals({ settings }: { settings: ExtensionSettings }) {
  // The app's own window, captured from its ENIGMA_APP_READY handshake. Only
  // this window is guaranteed to be at APP_ORIGIN.
  const appWindowRef = React.useRef<Window | null>(null);

  const token = settings.authToken ?? null;
  const user = settings.user ?? null;

  const sendToken = React.useCallback(() => {
    const win = appWindowRef.current;
    if (!win) return; // wait for the handshake before sending anything
    win.postMessage({ type: "ENIGMA_TOKEN", token, user }, APP_ORIGIN);
  }, [token, user]);

  React.useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== APP_ORIGIN) return;
      if ((ev.data as { type?: string } | null)?.type === "ENIGMA_APP_READY") {
        // ev.source is the app window, definitively at APP_ORIGIN — safe target.
        appWindowRef.current = ev.source as Window | null;
        sendToken();
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sendToken]);

  // Re-send whenever the token changes (e.g. after sign-in). No-op until the
  // app has handshaked (appWindowRef is null → sendToken returns early).
  React.useEffect(() => {
    sendToken();
  }, [sendToken]);

  return (
    <iframe
      src={APP_URL}
      title="ENIGMA Goals"
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
