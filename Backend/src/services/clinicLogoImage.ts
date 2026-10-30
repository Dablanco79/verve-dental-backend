import { createHash } from "node:crypto";

import sharp from "sharp";

import { AppError } from "../types/errors.js";

export const CLINIC_LOGO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const CLINIC_LOGO_STORED_MAX_BYTES = 512 * 1024;
export const CLINIC_LOGO_MAX_DIMENSION = 1600;
export const CLINIC_LOGO_MAX_INPUT_DIMENSION = 8000;
export const CLINIC_LOGO_MAX_INPUT_PIXELS = 16_000_000;

export type NormalizedClinicLogo = {
  imageData: Buffer;
  mimeType: "image/png" | "image/jpeg";
  sha256Checksum: string;
  width: number;
  height: number;
};

const OUTPUT_ATTEMPTS = [
  { dimension: 1600, quality: 90 },
  { dimension: 1400, quality: 85 },
  { dimension: 1200, quality: 80 },
  { dimension: 1000, quality: 75 },
  { dimension: 800, quality: 70 },
  { dimension: 600, quality: 65 },
] as const;

export async function normalizeClinicLogo(
  input: Buffer,
): Promise<NormalizedClinicLogo> {
  if (input.length === 0) {
    throw new AppError(400, "LOGO_FILE_REQUIRED", "Choose a PNG or JPEG logo to upload");
  }
  if (input.length > CLINIC_LOGO_UPLOAD_MAX_BYTES) {
    throw new AppError(
      413,
      "LOGO_FILE_TOO_LARGE",
      "Clinic logos must be 2 MB or smaller before processing",
    );
  }

  try {
    const metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: CLINIC_LOGO_MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata();

    if (metadata.format !== "png" && metadata.format !== "jpeg") {
      throw new AppError(
        400,
        "UNSUPPORTED_LOGO_FORMAT",
        "Only decoded PNG and JPEG images are accepted",
      );
    }
    if (!metadata.width || !metadata.height) {
      throw new AppError(400, "INVALID_LOGO_IMAGE", "The logo dimensions could not be read");
    }
    if (
      metadata.width > CLINIC_LOGO_MAX_INPUT_DIMENSION ||
      metadata.height > CLINIC_LOGO_MAX_INPUT_DIMENSION ||
      metadata.width * metadata.height > CLINIC_LOGO_MAX_INPUT_PIXELS
    ) {
      throw new AppError(
        413,
        "LOGO_DIMENSIONS_TOO_LARGE",
        "Clinic logos may contain at most 16 million pixels and be no larger than 8000 px per side",
      );
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new AppError(400, "ANIMATED_LOGO_NOT_ALLOWED", "Animated images are not accepted");
    }

    const preserveTransparency = metadata.hasAlpha;
    for (const attempt of OUTPUT_ATTEMPTS) {
      let pipeline = sharp(input, {
        failOn: "error",
        limitInputPixels: CLINIC_LOGO_MAX_INPUT_PIXELS,
        sequentialRead: true,
      })
        .rotate()
        .resize({
          width: attempt.dimension,
          height: attempt.dimension,
          fit: "inside",
          withoutEnlargement: true,
        });

      pipeline = preserveTransparency
        ? pipeline.png({
            compressionLevel: 9,
            palette: true,
            quality: attempt.quality,
          })
        : pipeline.jpeg({
            quality: attempt.quality,
            mozjpeg: true,
          });

      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      if (data.length <= CLINIC_LOGO_STORED_MAX_BYTES) {
        const mimeType = preserveTransparency ? "image/png" : "image/jpeg";
        return {
          imageData: data,
          mimeType,
          sha256Checksum: createHash("sha256").update(data).digest("hex"),
          width: info.width,
          height: info.height,
        };
      }
    }

    throw new AppError(
      413,
      "LOGO_NORMALIZED_TOO_LARGE",
      "The processed logo is still larger than 512 KB; choose a simpler or smaller image",
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      "INVALID_LOGO_IMAGE",
      "The uploaded file is not a valid, decodable PNG or JPEG image",
    );
  }
}
