/**
 * Installed-mode (standalone) detection for the PWA installation foundation.
 *
 * Pure, side-effect-free helpers. They never read tokens, cookies or any
 * browser storage, never call the network, and never log. They exist only so
 * physical-device testing can tell an installed launch from a browser tab.
 */

export type DisplayMode = "standalone" | "browser";
export type PlatformClass = "ios" | "android" | "other";

export type PwaDisplayInfo = {
  mode: DisplayMode;
  platform: PlatformClass;
};

/** The minimal browser surface needed; injectable so it is testable. */
export type DisplayModeEnvironment = {
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
  navigator?:
    | {
        standalone?: boolean;
        userAgent?: string;
        platform?: string;
        maxTouchPoints?: number;
      }
    | undefined;
};

export const PWA_DIAGNOSTICS_PARAM = "pwaDiagnostics";

/** Adapts a real `window`; tolerates environments without `matchMedia`. */
export function getBrowserEnvironment(win: Window): DisplayModeEnvironment {
  return {
    matchMedia:
      typeof win.matchMedia === "function"
        ? (query: string) => win.matchMedia(query)
        : undefined,
    navigator: win.navigator,
  };
}

export function isStandaloneDisplay(env: DisplayModeEnvironment): boolean {
  try {
    if (env.matchMedia?.("(display-mode: standalone)").matches === true) {
      return true;
    }
  } catch {
    // An unusable matchMedia is treated as "not standalone".
  }

  // iOS Safari home-screen apps expose navigator.standalone instead.
  return env.navigator?.standalone === true;
}

export function detectPlatform(env: DisplayModeEnvironment): PlatformClass {
  const nav = env.navigator;
  const userAgent = nav?.userAgent ?? "";

  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";

  // iPadOS 13+ reports a desktop-class ("Macintosh") user agent. A Mac with a
  // multi-touch screen is, in practice, an iPad.
  if (nav?.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1) {
    return "ios";
  }

  if (/Android/i.test(userAgent)) return "android";

  return "other";
}

export function getPwaDisplayInfo(env: DisplayModeEnvironment): PwaDisplayInfo {
  return {
    mode: isStandaloneDisplay(env) ? "standalone" : "browser",
    platform: detectPlatform(env),
  };
}

/** True only when the query string explicitly contains `pwaDiagnostics=1`. */
export function isPwaDiagnosticsRequested(search: string): boolean {
  return new URLSearchParams(search).get(PWA_DIAGNOSTICS_PARAM) === "1";
}
