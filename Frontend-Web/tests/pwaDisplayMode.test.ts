import { describe, expect, it } from "vitest";

import {
  detectPlatform,
  getBrowserEnvironment,
  getPwaDisplayInfo,
  isPwaDiagnosticsRequested,
  isStandaloneDisplay,
  type DisplayModeEnvironment,
} from "../src/pwa/displayMode.js";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function media(matches: boolean): DisplayModeEnvironment["matchMedia"] {
  return () => ({ matches });
}

describe("isStandaloneDisplay", () => {
  it("is standalone when the display-mode media query matches", () => {
    const queries: string[] = [];
    const env: DisplayModeEnvironment = {
      matchMedia: (query) => {
        queries.push(query);
        return { matches: true };
      },
    };

    expect(isStandaloneDisplay(env)).toBe(true);
    expect(queries).toEqual(["(display-mode: standalone)"]);
  });

  it("is standalone when iOS navigator.standalone is true", () => {
    expect(
      isStandaloneDisplay({ matchMedia: media(false), navigator: { standalone: true } }),
    ).toBe(true);
  });

  it("is a browser tab when neither signal is present", () => {
    expect(
      isStandaloneDisplay({ matchMedia: media(false), navigator: { standalone: false } }),
    ).toBe(false);
    expect(isStandaloneDisplay({ matchMedia: media(false), navigator: {} })).toBe(false);
  });

  it("tolerates a missing matchMedia and missing navigator", () => {
    expect(isStandaloneDisplay({})).toBe(false);
    expect(isStandaloneDisplay({ navigator: { standalone: true } })).toBe(true);
  });

  it("treats a throwing matchMedia as not standalone", () => {
    expect(
      isStandaloneDisplay({
        matchMedia: () => {
          throw new Error("unsupported");
        },
      }),
    ).toBe(false);
  });
});

describe("detectPlatform", () => {
  it("classifies iPhone, Android and desktop user agents", () => {
    expect(detectPlatform({ navigator: { userAgent: IPHONE_UA } })).toBe("ios");
    expect(detectPlatform({ navigator: { userAgent: ANDROID_UA } })).toBe("android");
    expect(detectPlatform({ navigator: { userAgent: DESKTOP_UA } })).toBe("other");
  });

  it("classifies a touch-capable desktop-class Mac user agent as iPadOS", () => {
    expect(
      detectPlatform({
        navigator: { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
      }),
    ).toBe("ios");
    expect(
      detectPlatform({
        navigator: { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 },
      }),
    ).toBe("other");
  });

  it("returns other when navigator is unavailable", () => {
    expect(detectPlatform({})).toBe("other");
  });
});

describe("getPwaDisplayInfo", () => {
  it("combines mode and platform and exposes nothing else", () => {
    const info = getPwaDisplayInfo({
      matchMedia: media(true),
      navigator: { userAgent: ANDROID_UA },
    });

    expect(info).toEqual({ mode: "standalone", platform: "android" });
  });

  it("reports an iOS home-screen launch via navigator.standalone", () => {
    expect(
      getPwaDisplayInfo({
        matchMedia: media(false),
        navigator: { userAgent: IPHONE_UA, standalone: true },
      }),
    ).toEqual({ mode: "standalone", platform: "ios" });
  });
});

describe("getBrowserEnvironment", () => {
  it("returns an undefined matchMedia when the window lacks one", () => {
    const win = { navigator: { userAgent: DESKTOP_UA } } as unknown as Window;

    expect(getBrowserEnvironment(win).matchMedia).toBeUndefined();
  });
});

describe("isPwaDiagnosticsRequested", () => {
  it.each([
    ["?pwaDiagnostics=1", true],
    ["?foo=bar&pwaDiagnostics=1", true],
    ["", false],
    ["?pwaDiagnostics=0", false],
    ["?pwaDiagnostics=true", false],
    ["?pwaDiagnostics", false],
    ["?PWADIAGNOSTICS=1", false],
  ])("%s -> %s", (search, expected) => {
    expect(isPwaDiagnosticsRequested(search)).toBe(expected);
  });
});
