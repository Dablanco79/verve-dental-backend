/**
 * ClaudeOcrProvider + ocrProviderFactory unit tests.
 *
 * ClaudeOcrProvider — injects a mock Anthropic client (no real API calls).
 * ocrProviderFactory — tests provider selection logic and startup guards.
 *
 * Coverage:
 *   ClaudeOcrProvider
 *   1.  PDF file sends document source block
 *   2.  PNG file sends image source block
 *   3.  JPEG file sends image source block
 *   4.  Unsupported MIME type throws 415
 *   5.  Structured JSON parsed into OcrInvoiceResult
 *   6.  Confidence values clamped 0–100
 *   7.  Claude API error wrapped into AppError 502
 *   8.  Non-JSON response wrapped into AppError 502
 *   9.  Lines with missing fields default gracefully
 *
 *   ocrProviderFactory
 *   10. Returns StubOcrProvider when ANTHROPIC_API_KEY absent in development
 *   11. Returns ClaudeOcrProvider when ANTHROPIC_API_KEY present
 *   12. Throws on missing key in production
 */

import { jest } from "@jest/globals";
import { ClaudeOcrProvider } from "../src/services/ocr/ClaudeOcrProvider.js";
import { createOcrProvider } from "../src/services/ocr/ocrProviderFactory.js";
import { AppError } from "../src/types/errors.js";
import type { EnvConfig } from "../src/config/index.js";
import type Anthropic from "@anthropic-ai/sdk";

// ── Mock Anthropic client helpers ─────────────────────────────────────────────

type ClaudeMessageResponse = { content: { type: string; text: string }[] };
type MockMessagesCreate = jest.MockedFunction<() => Promise<ClaudeMessageResponse>>;

function makeMockClient(createFn: MockMessagesCreate): Anthropic {
  return {
    messages: { create: createFn },
  } as unknown as Anthropic;
}

function makeClaudeResponse(jsonText: string): ClaudeMessageResponse {
  return {
    content: [{ type: "text", text: jsonText }],
  };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const VALID_JSON_RESPONSE = JSON.stringify({
  supplierName: "Acme Supplies",
  invoiceNumber: "INV-001",
  invoiceDate: "2026-06-01",
  dueDate: "2026-07-01",
  subtotalCents: 10000,
  taxCents: 1000,
  totalCents: 11000,
  overallConfidence: 94.5,
  lines: [
    {
      description: "Prophy Paste",
      sku: "PP100",
      quantity: 2,
      unitPriceCents: 5000,
      subtotalCents: 10000,
      taxRateBasisPoints: 1000,
      taxCents: 1000,
      totalCents: 11000,
      confidence: 97,
    },
  ],
});

const PDF_BUFFER = Buffer.from("%PDF-1.4 fake content");
const PNG_BUFFER = Buffer.from("\x89PNG\r\n\x1a\n fake png");
const JPEG_BUFFER = Buffer.from("\xff\xd8\xff fake jpeg");

// ─── ClaudeOcrProvider ────────────────────────────────────────────────────────

describe("ClaudeOcrProvider", () => {
  // ── 1. PDF sends document source block ────────────────────────────────────
  it("sends document source block for PDF files", async () => {
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>().mockResolvedValue(makeClaudeResponse(VALID_JSON_RESPONSE));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    await provider.extractInvoice(PDF_BUFFER, "application/pdf", "invoice.pdf");

    expect(createFn).toHaveBeenCalledTimes(1);
    const callArg = (createFn.mock.calls[0] as unknown[])[0] as {
      messages: { role: string; content: { type: string }[] }[];
    };
    const content = callArg.messages[0]?.content ?? [];
    const docBlock = content.find((b) => b.type === "document");
    expect(docBlock).toBeDefined();
  });

  // ── 2. PNG sends image source block ───────────────────────────────────────
  it("sends image source block for PNG files", async () => {
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>().mockResolvedValue(makeClaudeResponse(VALID_JSON_RESPONSE));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    await provider.extractInvoice(PNG_BUFFER, "image/png", "invoice.png");

    const callArg = (createFn.mock.calls[0] as unknown[])[0] as {
      messages: { role: string; content: { type: string }[] }[];
    };
    const imgBlock = (callArg.messages[0]?.content ?? []).find((b) => b.type === "image");
    expect(imgBlock).toBeDefined();
  });

  // ── 3. JPEG sends image source block ──────────────────────────────────────
  it("sends image source block for JPEG files", async () => {
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>().mockResolvedValue(makeClaudeResponse(VALID_JSON_RESPONSE));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    await provider.extractInvoice(JPEG_BUFFER, "image/jpeg", "invoice.jpg");

    const callArg = (createFn.mock.calls[0] as unknown[])[0] as {
      messages: { role: string; content: { type: string }[] }[];
    };
    const imgBlock = (callArg.messages[0]?.content ?? []).find((b) => b.type === "image");
    expect(imgBlock).toBeDefined();
  });

  // ── 4. Unsupported MIME throws 415 ────────────────────────────────────────
  it("throws 415 UNSUPPORTED_MEDIA_TYPE for TIFF files", async () => {
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>();
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    await expect(
      provider.extractInvoice(Buffer.from("x"), "image/tiff", "invoice.tiff"),
    ).rejects.toMatchObject({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    } satisfies Partial<AppError>);

    expect(createFn).not.toHaveBeenCalled();
  });

  // ── 5. Parses structured JSON into OcrInvoiceResult ──────────────────────
  it("parses Claude JSON response into a correct OcrInvoiceResult", async () => {
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>().mockResolvedValue(makeClaudeResponse(VALID_JSON_RESPONSE));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    const result = await provider.extractInvoice(PDF_BUFFER, "application/pdf", "invoice.pdf");

    expect(result.provider).toBe("anthropic");
    expect(result.supplierName).toBe("Acme Supplies");
    expect(result.invoiceNumber).toBe("INV-001");
    expect(result.invoiceDate).toBe("2026-06-01");
    expect(result.subtotalCents).toBe(10_000);
    expect(result.taxCents).toBe(1_000);
    expect(result.totalCents).toBe(11_000);
    expect(result.overallConfidence).toBe(94.5);
    expect(result.lines).toHaveLength(1);
    const firstLine = result.lines[0];
    expect(firstLine?.description).toBe("Prophy Paste");
    expect(firstLine?.confidence).toBe(97);
  });

  // ── 6. Confidence clamped 0–100 ────────────────────────────────────────────
  it("clamps confidence values to [0, 100]", async () => {
    const overRange = JSON.stringify({
      ...JSON.parse(VALID_JSON_RESPONSE) as object,
      overallConfidence: 150,
      lines: [
        {
          ...(JSON.parse(VALID_JSON_RESPONSE) as { lines: unknown[] }).lines[0] as object,
          confidence: -5,
        },
      ],
    });
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>().mockResolvedValue(makeClaudeResponse(overRange));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    const result = await provider.extractInvoice(PDF_BUFFER, "application/pdf", "test.pdf");

    expect(result.overallConfidence).toBe(100);
    expect(result.lines[0]?.confidence).toBe(0);
  });

  // ── 7. Claude API error wrapped as 502 ────────────────────────────────────
  it("wraps Claude API errors as 502 OCR_PROVIDER_ERROR", async () => {
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>().mockRejectedValue(new Error("Connection timeout"));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    await expect(
      provider.extractInvoice(PDF_BUFFER, "application/pdf", "invoice.pdf"),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "OCR_PROVIDER_ERROR",
    } satisfies Partial<AppError>);
  });

  // ── 8. Non-JSON response wrapped as 502 ───────────────────────────────────
  it("wraps non-JSON Claude response as 502 OCR_PARSE_ERROR", async () => {
    const createFn = jest
      .fn<() => Promise<ClaudeMessageResponse>>()
      .mockResolvedValue(makeClaudeResponse("I cannot process this document."));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    await expect(
      provider.extractInvoice(PDF_BUFFER, "application/pdf", "invoice.pdf"),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "OCR_PARSE_ERROR",
    } satisfies Partial<AppError>);
  });

  // ── 9. Lines with missing fields default gracefully ────────────────────────
  it("handles lines with missing optional fields without throwing", async () => {
    const sparseLines = JSON.stringify({
      supplierName: null,
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      subtotalCents: null,
      taxCents: null,
      totalCents: null,
      overallConfidence: null,
      lines: [
        {
          description: "Mystery item",
          quantity: 1,
          unitPriceCents: 500,
          // missing subtotalCents, taxRateBasisPoints, taxCents, totalCents, confidence, sku
        },
      ],
    });
    const createFn = jest.fn<() => Promise<ClaudeMessageResponse>>().mockResolvedValue(makeClaudeResponse(sparseLines));
    const provider = new ClaudeOcrProvider("key", "model", makeMockClient(createFn));

    const result = await provider.extractInvoice(PDF_BUFFER, "application/pdf", "sparse.pdf");

    expect(result.lines).toHaveLength(1);
    // subtotal = 1 × 500 = 500; tax at default 1000bp = 50; total = 550
    const sparseLine = result.lines[0];
    expect(sparseLine?.subtotalCents).toBe(500);
    expect(sparseLine?.taxCents).toBe(50);
    expect(sparseLine?.confidence).toBeNull();
  });
});

// ─── ocrProviderFactory ───────────────────────────────────────────────────────

describe("createOcrProvider", () => {
  function makeConfig(overrides: Partial<EnvConfig>): EnvConfig {
    return {
      NODE_ENV: "development",
      PORT: 3000,
      HOST: "0.0.0.0",
      LOG_LEVEL: "info",
      CORS_ORIGIN: "http://localhost:5173",
      JWT_ACCESS_SECRET: "test-access-secret-minimum-32-characters-long",
      JWT_REFRESH_SECRET: "test-refresh-secret-minimum-32-characters-long",
      JWT_ACCESS_EXPIRES_IN: "15m",
      JWT_REFRESH_EXPIRES_IN: "7d",
      DATABASE_SSL: "auto",
      REDIS_TLS: "auto",
      MFA_ENCRYPTION_KEY: "0".repeat(64),
      MIGRATE_ON_STARTUP: false,
      OCR_PROVIDER: "anthropic",
      OCR_CLAUDE_MODEL: "claude-opus-4-5",
      OCR_MAX_FILE_SIZE_BYTES: 20_971_520,
      ...overrides,
    } satisfies EnvConfig;
  }

  // ── 10. Falls back to stub when no API key in dev ─────────────────────────
  it("returns a StubOcrProvider in development when ANTHROPIC_API_KEY is absent", async () => {
    const config = makeConfig({ NODE_ENV: "development", ANTHROPIC_API_KEY: undefined });
    const provider = createOcrProvider(config);

    const result = await provider.extractInvoice(
      Buffer.from("x"),
      "application/pdf",
      "test.pdf",
    );

    expect(result.provider).toBe("stub");
    expect(result.lines).toHaveLength(1);
  });

  // ── 11. Returns ClaudeOcrProvider when key present ────────────────────────
  it("returns a ClaudeOcrProvider when ANTHROPIC_API_KEY is set", () => {
    const config = makeConfig({ ANTHROPIC_API_KEY: "sk-ant-test-key" });
    const provider = createOcrProvider(config);

    expect(provider).toBeInstanceOf(ClaudeOcrProvider);
  });

  // ── 12. Throws in production when key missing ─────────────────────────────
  it("throws at startup in production when ANTHROPIC_API_KEY is missing", () => {
    const config = makeConfig({
      NODE_ENV: "production",
      ANTHROPIC_API_KEY: undefined,
    });

    expect(() => createOcrProvider(config)).toThrow(/ANTHROPIC_API_KEY is required/);
  });
});
