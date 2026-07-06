import type { Request, Response } from "express";
import { z } from "zod";

import type {
  ImportFormat,
  MasterProductImportService,
} from "../services/masterProductImportService.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

const importBodySchema = z.object({
  clinicId: z.string().uuid().optional(),
});

function resolveFormat(filename: string, mimetype: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || mimetype === "text/csv") {
    return "csv";
  }
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  throw new AppError(
    400,
    "UNSUPPORTED_FORMAT",
    `Unsupported file format "${filename}". Only CSV (.csv) and Excel (.xlsx/.xls) files are accepted.`,
  );
}

export function createMasterProductImportHandlers(
  masterProductImportService: MasterProductImportService,
) {
  return {
    /**
     * Imports a curated Master Product Library file into master_catalog_items.
     * Catalogue-only: never touches stock quantities or adjustment history.
     *
     * POST /master-products/import
     * Content-Type: multipart/form-data  (fields: file, clinicId?)
     */
    async importLibrary(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "file", message: "A file must be uploaded" },
        ]);
      }

      const bodyResult = importBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(bodyResult.error),
        );
      }

      const format = resolveFormat(file.originalname, file.mimetype);

      const result = await masterProductImportService.importLibrary(
        req.user,
        file.buffer,
        format,
        bodyResult.data.clinicId ?? null,
      );

      res.status(200).json({ data: result });
    },
  };
}

export type MasterProductImportHandlers = ReturnType<
  typeof createMasterProductImportHandlers
>;
