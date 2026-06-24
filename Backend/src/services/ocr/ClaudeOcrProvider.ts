/**
 * Anthropic Claude OCR provider — Sprint OCR-1.
 *
 * Uses Claude's native document and image input to extract structured invoice
 * data without any PDF-to-image conversion step.  Multi-page PDFs are supported
 * from day one via Claude's built-in document understanding.
 *
 * PDF files     → content block type: 'document', media_type: 'application/pdf'
 * PNG/JPEG files → content block type: 'image',    media_type: 'image/png' | 'image/jpeg'
 *
 * The prompt instructs Claude to return ONLY valid JSON matching OcrInvoiceResult.
 * All monetary values are requested as integer CENTS so no float-to-cent
 * conversion is needed in the service layer.
 *
 * The full raw response is stored in ocr_raw_response for audit and replay.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { OcrProvider } from "./OcrProvider.js";
import type { OcrInvoiceResult, OcrInvoiceLine } from "../../types/supplierInvoice.js";
import { AppError } from "../../types/errors.js";

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;

type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

function isSupportedMimeType(mimeType: string): mimeType is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

function normaliseConfidence(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (isNaN(n)) return null;
  return Math.min(Math.max(Math.round(n * 10) / 10, 0), 100);
}

function safeInt(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Math.round(Number(raw));
  if (isNaN(n)) return null;
  return n;
}

function safePositiveFloat(raw: unknown): number {
  const n = Number(raw);
  if (isNaN(n) || n <= 0) return 1;
  return n;
}

const EXTRACTION_PROMPT = `You are an invoice data extraction assistant. Extract all data from this supplier invoice document.

Return ONLY valid JSON — no markdown fences, no explanation, no commentary. Use exactly this structure:

{
  "supplierName": "string or null",
  "supplierAbn": "string or null",
  "supplierEmail": "string or null",
  "supplierPhone": "string or null",
  "supplierAddress": "string or null",
  "supplierWebsite": "string or null",
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "subtotalCents": integer_or_null,
  "taxCents": integer_or_null,
  "totalCents": integer_or_null,
  "overallConfidence": number_0_to_100,
  "lines": [
    {
      "description": "string",
      "sku": "string or null",
      "quantity": number,
      "unitPriceCents": integer,
      "subtotalCents": integer,
      "taxRateBasisPoints": integer,
      "taxCents": integer,
      "totalCents": integer,
      "confidence": number_0_to_100
    }
  ]
}

Rules:
- ALL monetary values MUST be integer cents (AUD). Example: $12.50 = 1250, $100.00 = 10000
- taxRateBasisPoints: 1000 = 10% GST, 0 = no tax, 500 = 5%
- overallConfidence: your overall confidence in the extraction accuracy (0 = certain failure, 100 = perfect)
- confidence per line: your confidence that each individual line was extracted correctly (0–100)
- Use null for any field you cannot determine with reasonable confidence
- Dates must be in YYYY-MM-DD format
- supplierAbn: extract the supplier's ABN (Australian Business Number) if present, as printed (e.g. "12 345 678 901")
- supplierEmail: extract the supplier's contact email address if visible on the invoice
- supplierPhone: extract the supplier's phone number if visible on the invoice
- supplierAddress: extract the supplier's full postal/street address if visible on the invoice
- supplierWebsite: extract the supplier's website URL if visible on the invoice
- Extract ALL line items visible on the invoice
- If the document is not an invoice, return all null fields and overallConfidence: 0`;

export class ClaudeOcrProvider implements OcrProvider {
  private client: Anthropic;
  private model: string;

  /**
   * @param apiKey   Anthropic API key.
   * @param model    Claude model slug.
   * @param client   Optional pre-constructed Anthropic client (used in tests).
   */
  constructor(apiKey: string, model: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
    this.model = model;
  }

  async extractInvoice(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<OcrInvoiceResult> {
    const normalisedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;

    if (!isSupportedMimeType(normalisedMime)) {
      throw new AppError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        `Unsupported file type: ${mimeType}. Accepted: PDF, PNG, JPEG.`,
      );
    }

    const base64Data = buffer.toString("base64");

    // Build the content block based on file type.
    // PDFs use Claude's 'document' source type for native multi-page support.
    // Images use the 'image' source type.
    type ContentBlock =
      | {
          type: "document";
          source: { type: "base64"; media_type: "application/pdf"; data: string };
        }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/png" | "image/jpeg";
            data: string;
          };
        }
      | { type: "text"; text: string };

    const fileBlock: ContentBlock =
      normalisedMime === "application/pdf"
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Data,
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: normalisedMime as "image/png" | "image/jpeg",
              data: base64Data,
            },
          };

    const textBlock: ContentBlock = {
      type: "text",
      text: `Filename: ${filename}\n\n${EXTRACTION_PROMPT}`,
    };

    let rawResponse: unknown;
    let rawText: string;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [fileBlock, textBlock],
          },
        ],
      });

      rawResponse = response;

      const textContent = response.content.find((c) => c.type === "text");
      rawText = textContent && "text" in textContent ? textContent.text : "";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown Claude API error";
      throw new AppError(502, "OCR_PROVIDER_ERROR", `Claude API error: ${message}`);
    }

    // Parse the JSON response.
    let parsed: Record<string, unknown>;
    try {
      const cleaned = rawText.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      throw new AppError(
        502,
        "OCR_PARSE_ERROR",
        `Claude returned non-JSON response for file: ${filename}`,
      );
    }

    const lines = this.parseLines(parsed.lines);

    return {
      provider: "anthropic",
      supplierName: typeof parsed.supplierName === "string" ? parsed.supplierName : null,
      supplierAbn: typeof parsed.supplierAbn === "string" ? parsed.supplierAbn : null,
      supplierEmail: typeof parsed.supplierEmail === "string" ? parsed.supplierEmail : null,
      supplierPhone: typeof parsed.supplierPhone === "string" ? parsed.supplierPhone : null,
      supplierAddress: typeof parsed.supplierAddress === "string" ? parsed.supplierAddress : null,
      supplierWebsite: typeof parsed.supplierWebsite === "string" ? parsed.supplierWebsite : null,
      invoiceNumber: typeof parsed.invoiceNumber === "string" ? parsed.invoiceNumber : null,
      invoiceDate: typeof parsed.invoiceDate === "string" ? parsed.invoiceDate : null,
      dueDate: typeof parsed.dueDate === "string" ? parsed.dueDate : null,
      subtotalCents: safeInt(parsed.subtotalCents),
      taxCents: safeInt(parsed.taxCents),
      totalCents: safeInt(parsed.totalCents),
      overallConfidence: normaliseConfidence(parsed.overallConfidence),
      lines,
      rawResponse,
    };
  }

  private parseLines(rawLines: unknown): OcrInvoiceLine[] {
    if (!Array.isArray(rawLines)) return [];

    return rawLines.map((item: unknown): OcrInvoiceLine => {
      const line = (item ?? {}) as Record<string, unknown>;
      const quantity = safePositiveFloat(line.quantity);
      const unitPriceCents = safeInt(line.unitPriceCents) ?? 0;
      const taxRateBasisPoints = safeInt(line.taxRateBasisPoints) ?? 1000;
      const subtotalCents = safeInt(line.subtotalCents) ?? Math.round(quantity * unitPriceCents);
      const taxCents = safeInt(line.taxCents) ?? Math.round((subtotalCents * taxRateBasisPoints) / 10_000);
      const totalCents = safeInt(line.totalCents) ?? subtotalCents + taxCents;

      return {
        description: typeof line.description === "string" ? line.description : "Unknown item",
        sku: typeof line.sku === "string" ? line.sku : null,
        quantity,
        unitPriceCents,
        subtotalCents,
        taxRateBasisPoints,
        taxCents,
        totalCents,
        confidence: normaliseConfidence(line.confidence),
      };
    });
  }
}
