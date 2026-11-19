import { useState } from "react";

import {
  getBrowserEnvironment,
  getPwaDisplayInfo,
  isPwaDiagnosticsRequested,
  type PwaDisplayInfo,
} from "./displayMode.js";

const MODE_LABEL: Record<PwaDisplayInfo["mode"], string> = {
  standalone: "Standalone (installed)",
  browser: "Browser tab",
};

const PLATFORM_LABEL: Record<PwaDisplayInfo["platform"], string> = {
  ios: "iOS",
  android: "Android",
  other: "Other",
};

/**
 * Explicit, opt-in installed-mode indicator for device testing.
 *
 * Renders nothing unless the page was opened with `?pwaDiagnostics=1`. It is
 * evaluated once at mount and held in memory only: no storage, no network, no
 * token or session access, and no routing or authentication side effects.
 * Pointer events are disabled so it can never intercept interaction.
 */
export function PwaDiagnostics() {
  const [info] = useState<PwaDisplayInfo | null>(() => {
    if (!isPwaDiagnosticsRequested(window.location.search)) return null;
    return getPwaDisplayInfo(getBrowserEnvironment(window));
  });

  if (info === null) return null;

  return (
    <div
      role="status"
      data-testid="pwa-diagnostics"
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        zIndex: 2147483647,
        padding: "6px 10px",
        borderRadius: 8,
        background: "#0B1026",
        color: "#35D5ED",
        border: "1px solid #3978F6",
        font: "12px/1.4 system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <div>Display mode: {MODE_LABEL[info.mode]}</div>
      <div>Platform: {PLATFORM_LABEL[info.platform]}</div>
    </div>
  );
}
