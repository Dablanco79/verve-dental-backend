import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import indexHtml from "../index.html?raw";
import icon192 from "../public/icons/icon-192.png?inline";
import icon512 from "../public/icons/icon-512.png?inline";
import manifestRaw from "../public/manifest.webmanifest?raw";
import { PwaDiagnostics } from "../src/pwa/PwaDiagnostics.js";

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type Manifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  display: string;
  start_url: string;
  scope: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
};

const manifest = JSON.parse(manifestRaw) as Manifest;

function readPng(dataUri: string): { width: number; height: number; bitDepth: number } {
  const prefix = "data:image/png;base64,";
  expect(dataUri.startsWith(prefix)).toBe(true);

  const binary = atob(dataUri.slice(prefix.length));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  // First chunk must be IHDR.
  expect(String.fromCharCode(...bytes.slice(12, 16))).toBe("IHDR");

  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: view.getUint8(24),
  };
}

describe("web app manifest", () => {
  it("identifies RENQOR as a standalone app", () => {
    expect(manifest.name).toBe("RENQOR");
    expect(manifest.short_name).toBe("RENQOR");
    expect(manifest.description).toBe("Workforce operations platform");
    expect(manifest.display).toBe("standalone");
  });

  it("uses a relative, origin-scoped identity, start URL and scope", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");

    for (const value of [manifest.id, manifest.start_url, manifest.scope]) {
      expect(value).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
    }
  });

  it("does not hardcode any absolute URL", () => {
    expect(manifestRaw).not.toMatch(/https?:\/\//i);
  });

  it("uses the RENQOR midnight navy palette", () => {
    expect(manifest.background_color).toBe("#0B1026");
    expect(manifest.theme_color).toBe("#0B1026");
  });

  it("declares 192 and 512 PNG icons under /icons", () => {
    const bySize = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));

    expect(bySize.get("192x192")).toMatchObject({
      src: "/icons/icon-192.png",
      type: "image/png",
    });
    expect(bySize.get("512x512")).toMatchObject({
      src: "/icons/icon-512.png",
      type: "image/png",
    });
  });
});

describe("generated PNG icons", () => {
  it("icon-192.png is a valid 192x192 PNG", () => {
    const png = readPng(icon192);

    expect(png.width).toBe(192);
    expect(png.height).toBe(192);
    expect(png.bitDepth).toBe(8);
  });

  it("icon-512.png is a valid 512x512 PNG", () => {
    const png = readPng(icon512);

    expect(png.width).toBe(512);
    expect(png.height).toBe(512);
    expect(png.bitDepth).toBe(8);
  });
});

describe("index.html installation metadata", () => {
  it("links the manifest", () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it("adds Apple standalone metadata", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title" content="RENQOR"');
    expect(indexHtml).toContain('name="mobile-web-app-capable" content="yes"');
  });

  it("preserves existing title, viewport, theme colour and icon references", () => {
    expect(indexHtml).toContain("<title>RENQOR | Operational Intelligence</title>");
    expect(indexHtml).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    );
    expect(indexHtml).toContain('<meta name="theme-color" content="#0B1026" />');
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(indexHtml).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });

  it("does not register a service worker in Phase 0A", () => {
    expect(indexHtml).not.toMatch(/serviceWorker/i);
  });
});

describe("PwaDiagnostics visibility", () => {
  const originalUrl = window.location.href;

  function openWith(search: string): void {
    window.history.replaceState(null, "", `/${search}`);
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", originalUrl);
  });

  it("renders nothing without the explicit query parameter", () => {
    openWith("");
    const { container } = render(<PwaDiagnostics />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("pwa-diagnostics")).toBeNull();
  });

  it.each(["?pwaDiagnostics=0", "?pwaDiagnostics=true", "?other=1"])(
    "renders nothing for %s",
    (search) => {
      openWith(search);
      const { container } = render(<PwaDiagnostics />);

      expect(container).toBeEmptyDOMElement();
    },
  );

  it("shows only mode and platform when ?pwaDiagnostics=1 is present", () => {
    openWith("?pwaDiagnostics=1");
    render(<PwaDiagnostics />);

    const badge = screen.getByTestId("pwa-diagnostics");
    expect(badge).toHaveAttribute("role", "status");
    expect(badge).toHaveTextContent(/Display mode: (Standalone \(installed\)|Browser tab)/);
    expect(badge).toHaveTextContent(/Platform: (iOS|Android|Other)/);
    expect(badge.style.pointerEvents).toBe("none");
  });

  it("makes no network request and never touches browser storage", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    openWith("?pwaDiagnostics=1");
    render(<PwaDiagnostics />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");

    vi.unstubAllGlobals();
  });
});
