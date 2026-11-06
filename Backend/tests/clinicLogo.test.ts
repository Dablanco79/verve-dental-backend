import request from "supertest";
import sharp from "sharp";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import {
  CLINIC_LOGO_STORED_MAX_BYTES,
  normalizeClinicLogo,
} from "../src/services/clinicLogoImage.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

async function pngLogo(colour = "#7957e8"): Promise<Buffer> {
  return sharp({
    create: {
      width: 320,
      height: 120,
      channels: 4,
      background: colour,
    },
  }).png().toBuffer();
}

async function jpegLogo(): Promise<Buffer> {
  return sharp({
    create: {
      width: 360,
      height: 140,
      channels: 3,
      background: "#3978f6",
    },
  }).jpeg().toBuffer();
}

const logoUrl = (clinicId: string) => `/api/v1/clinics/${clinicId}/logo`;

type LogoMetadata = {
  clinicId: string;
  mimeType: "image/png" | "image/jpeg";
  sha256Checksum: string;
  width: number;
  height: number;
};

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

describe("clinic logo API", () => {
  it("requires authentication for retrieval", async () => {
    const app = await createTestApp();
    expect((await request(app).get(logoUrl(SEED_CLINIC_A_ID))).status).toBe(401);
  });

  it("allows Owner/Admin to upload, replace, retrieve and delete a logo", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const first = await request(app)
      .put(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .attach("file", await pngLogo(), {
        filename: "clinic-logo.png",
        contentType: "image/png",
      });
    expect(first.status).toBe(200);
    const firstBody = first.body as ApiData<LogoMetadata>;
    expect(firstBody.data).toMatchObject({
      clinicId: SEED_CLINIC_A_ID,
      mimeType: "image/png",
      width: 320,
      height: 120,
    });
    const firstChecksum = firstBody.data.sha256Checksum;
    expect(firstChecksum).toMatch(/^[0-9a-f]{64}$/);

    const retrieved = await request(app)
      .get(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .buffer(true);
    expect(retrieved.status).toBe(200);
    expect(retrieved.headers["content-type"]).toMatch(/^image\/png/);
    expect(retrieved.headers["cache-control"]).toContain("private");
    expect(retrieved.headers["x-content-type-options"]).toBe("nosniff");
    expect(retrieved.headers.etag).toBe(`"${firstChecksum}"`);

    const replacement = await request(app)
      .put(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .attach("file", await jpegLogo(), {
        filename: "replacement.jpg",
        contentType: "image/jpeg",
      });
    expect(replacement.status).toBe(200);
    const replacementBody = replacement.body as ApiData<LogoMetadata>;
    expect(replacementBody.data.mimeType).toBe("image/jpeg");
    expect(replacementBody.data.sha256Checksum).not.toBe(firstChecksum);

    expect(
      (await request(app)
        .delete(logoUrl(SEED_CLINIC_A_ID))
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(204);
    const missing = await request(app)
      .get(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);
    expect((missing.body as ApiError).error.code).toBe("CLINIC_LOGO_NOT_FOUND");
  });

  it("allows an authenticated GPM and staff member to retrieve their clinic logo", async () => {
    const app = await createTestApp();
    const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    await request(app)
      .put(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("file", await pngLogo(), {
        filename: "clinic.png",
        contentType: "image/png",
      });

    for (const email of ["manager@clinic-a.au", "staff@clinic-a.au"]) {
      const token = await loginAndGetAccessToken(app, email);
      const response = await request(app)
        .get(logoUrl(SEED_CLINIC_A_ID))
        .set("Authorization", `Bearer ${token}`);
      expect(response.status).toBe(200);
    }
  });

  it("forbids GPM upload and delete through direct API calls", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const upload = await request(app)
      .put(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .attach("file", await pngLogo(), {
        filename: "clinic.png",
        contentType: "image/png",
      });
    expect(upload.status).toBe(403);

    const deletion = await request(app)
      .delete(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(deletion.status).toBe(403);
  });

  it("blocks clinical staff from retrieving another clinic's logo", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const response = await request(app)
      .get(logoUrl(SEED_CLINIC_B_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect((response.body as ApiError).error.code).toBe("TENANT_ACCESS_DENIED");
  });

  it("blocks an Owner/Admin from reading or mutating another organisation's logo", async () => {
    const existingBytes = Buffer.from("other-organisation-logo");
    let findStoredAsset: (() => Promise<Buffer | null>) | undefined;
    let deleteStoredAsset: (() => Promise<boolean>) | undefined;
    const app = await createTestApp({
      configureDependencies: async (deps) => {
        const repository = deps.clinicRepository;
        await repository.upsertBrandAsset({
          clinicId: SEED_CLINIC_B_ID,
          imageData: existingBytes,
          mimeType: "image/png",
          sha256Checksum: "b".repeat(64),
          width: 1,
          height: 1,
          updatedByUserId: null,
        });
        findStoredAsset = async () =>
          (await repository.findBrandAsset(SEED_CLINIC_B_ID))?.imageData ?? null;
        deleteStoredAsset = () => repository.deleteBrandAsset(SEED_CLINIC_B_ID);
        deps.clinicRepository = {
          ...repository,
          async findById(id) {
            const clinic = await repository.findById(id);
            if (!clinic) return null;
            if (id === SEED_CLINIC_A_ID) {
              return { ...clinic, organisationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
            }
            if (id === SEED_CLINIC_B_ID) {
              return { ...clinic, organisationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
            }
            return clinic;
          },
        };
      },
    });
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const retrieval = await request(app)
      .get(logoUrl(SEED_CLINIC_B_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(retrieval.status).toBe(403);
    expect((retrieval.body as ApiError).error.code).toBe("TENANT_ACCESS_DENIED");

    for (const method of ["put", "delete"] as const) {
      const pending = request(app)[method](logoUrl(SEED_CLINIC_B_ID))
        .set("Authorization", `Bearer ${token}`);
      const response = method === "put"
        ? await pending.attach("file", await pngLogo("#ff0000"), {
            filename: "replacement.png",
            contentType: "image/png",
          })
        : await pending;
      expect(response.status).toBe(403);
      expect((response.body as ApiError).error.code).toBe("TENANT_ACCESS_DENIED");
    }

    expect(findStoredAsset).toBeDefined();
    await expect(findStoredAsset?.()).resolves.toEqual(existingBytes);

    expect(deleteStoredAsset).toBeDefined();
    await expect(deleteStoredAsset?.()).resolves.toBe(true);
    const upload = await request(app)
      .put(logoUrl(SEED_CLINIC_B_ID))
      .set("Authorization", `Bearer ${token}`)
      .attach("file", await pngLogo("#00ff00"), {
        filename: "new-logo.png",
        contentType: "image/png",
      });
    expect(upload.status).toBe(403);
    expect((upload.body as ApiError).error.code).toBe("TENANT_ACCESS_DENIED");
    await expect(findStoredAsset?.()).resolves.toBeNull();
  });

  it("allows a GPM to retrieve an operationally assigned clinic logo", async () => {
    const app = await createTestApp({
      configureDependencies: async (deps) => {
        await deps.clinicAssignmentsRepository.upsert({
          userId: SEED_USER_IDS.clinicAManager,
          clinicId: SEED_CLINIC_B_ID,
          canRoster: false,
          canOperate: true,
        });
      },
    });
    const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    expect(
      (await request(app)
        .put(logoUrl(SEED_CLINIC_B_ID))
        .set("Authorization", `Bearer ${ownerToken}`)
        .attach("file", await pngLogo(), {
          filename: "clinic-b.png",
          contentType: "image/png",
        })).status,
    ).toBe(200);

    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const response = await request(app)
      .get(logoUrl(SEED_CLINIC_B_ID))
      .set("Authorization", `Bearer ${managerToken}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^image\/png/);
  });

  it("rejects malformed, unsupported and oversized uploads without persisting them", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const malformed = await request(app)
      .put(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("not a png"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    expect(malformed.status).toBe(400);
    expect((malformed.body as ApiError).error.code).toBe("INVALID_LOGO_IMAGE");

    const unsupported = await request(app)
      .put(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("<svg/>"), {
        filename: "logo.svg",
        contentType: "image/svg+xml",
      });
    expect(unsupported.status).toBe(400);
    expect((unsupported.body as ApiError).error.code).toBe("UNSUPPORTED_LOGO_FORMAT");

    const oversized = await request(app)
      .put(logoUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.alloc(2 * 1024 * 1024 + 1), {
        filename: "huge.png",
        contentType: "image/png",
      });
    expect(oversized.status).toBe(413);
    expect((oversized.body as ApiError).error.code).toBe("LOGO_FILE_TOO_LARGE");

    expect(
      (await request(app)
        .get(logoUrl(SEED_CLINIC_A_ID))
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(404);
  });
});

describe("clinic logo image normalization", () => {
  it("normalizes bytes, strips metadata and enforces the stored-size ceiling", async () => {
    const input = await sharp(await jpegLogo())
      .withMetadata({ exif: { IFD0: { Copyright: "private metadata" } } })
      .toBuffer();
    const normalized = await normalizeClinicLogo(input);
    const metadata = await sharp(normalized.imageData).metadata();

    expect(normalized.mimeType).toBe("image/jpeg");
    expect(normalized.imageData.length).toBeLessThanOrEqual(CLINIC_LOGO_STORED_MAX_BYTES);
    expect(normalized.sha256Checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(metadata.exif).toBeUndefined();
  });

  it("rejects decoded images that exceed the dimension limit", async () => {
    const tooWide = await sharp({
      create: {
        width: 8001,
        height: 1,
        channels: 3,
        background: "#000000",
      },
    }).png().toBuffer();
    await expect(normalizeClinicLogo(tooWide)).rejects.toMatchObject({
      code: "LOGO_DIMENSIONS_TOO_LARGE",
      statusCode: 413,
    });
  });
});
