import { z } from "zod";
import type { Request, Response } from "express";

import type { CatalogueImportService } from "../services/catalogueImportService.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const manualMappingsSchema = z
  .record(z.string(), z.string().uuid())
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const result: Record<number, string> = {};
    for (const [k, val] of Object.entries(v)) {
      const num = parseInt(k, 10);
      if (!isNaN(num)) result[num] = val;
    }
    return result;
  });

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createCatalogueImportHandlers(
  service: CatalogueImportService,
) {
  return {
    /**
     * Phase 1: parse the uploaded file and run product matching.
     * Returns a preview of rows with match status — no writes.
     *
     * POST /suppliers/:supplierId/catalogue/import/preview
     * Content-Type: multipart/form-data  (field: file)
     */
    async preview(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const supplierIdResult = uuidSchema.safeParse(req.params.supplierId);
      if (!supplierIdResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "supplierId", message: "supplierId must be a valid UUID" },
        ]);
      }

      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "file", message: "A file must be uploaded" },
        ]);
      }

      const format = resolveFormat(file.originalname, file.mimetype);

      const result = await service.preview(
        supplierIdResult.data,
        file.buffer,
        format,
      );

      res.status(200).json({ data: result });
    },

    /**
     * Phase 2: confirm import — persist catalogue entries for matched rows.
     * Accepts optional manualMappings to override unmatched rows.
     *
     * POST /suppliers/:supplierId/catalogue/import/confirm
     * Content-Type: multipart/form-data  (fields: file, manualMappings?)
     */
    async confirm(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const supplierIdResult = uuidSchema.safeParse(req.params.supplierId);
      if (!supplierIdResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "supplierId", message: "supplierId must be a valid UUID" },
        ]);
      }

      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "file", message: "A file must be uploaded" },
        ]);
      }

      // manualMappings may be sent as a JSON string in a form field
      let manualMappings: Record<number, string> | undefined;
      const rawMappings = (req.body as Record<string, unknown>).manualMappings;
      if (rawMappings) {
        let parsed: unknown;
        if (typeof rawMappings === "string") {
          try {
            parsed = JSON.parse(rawMappings);
          } catch {
            throw new AppError(
              400,
              "VALIDATION_ERROR",
              "Request validation failed",
              [{ field: "manualMappings", message: "manualMappings must be valid JSON" }],
            );
          }
        } else {
          parsed = rawMappings;
        }

        const mappingsResult = manualMappingsSchema.safeParse(parsed);
        if (!mappingsResult.success) {
          throw new AppError(
            400,
            "VALIDATION_ERROR",
            "Request validation failed",
            zodToDetails(mappingsResult.error),
          );
        }
        manualMappings = mappingsResult.data;
      }

      const format = resolveFormat(file.originalname, file.mimetype);

      const result = await service.confirm(
        supplierIdResult.data,
        file.buffer,
        format,
        manualMappings,
      );

      res.status(200).json({ data: result });
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveFormat(
  filename: string,
  mimetype: string,
): "csv" | "xlsx" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || mimetype === "text/csv") {
    return "csv";
  }
  if (
    lower.endsWith(".xlsx") ||
    mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  throw new AppError(
    400,
    "UNSUPPORTED_FORMAT",
    `Unsupported file format "${filename}". Only CSV (.csv) and Excel (.xlsx) files are accepted.`,
  );
}

export type CatalogueImportHandlers = ReturnType<
  typeof createCatalogueImportHandlers
>;
