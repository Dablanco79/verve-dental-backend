import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import sharp from "sharp";

import { createApp } from "../src/app.js";
import {
  createAppDependencies,
  type AppDependencies,
} from "../src/bootstrap/dependencies.js";
import { loadConfig } from "../src/config/index.js";
import {
  AUTH_BYPASS_CLINIC_ID,
  withTenantContext,
} from "../src/db/tenantContext.js";
import {
  SEED_ADMIN_TOTP_SECRET,
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { encryptTotpSecret } from "../src/utils/mfaCrypto.js";
import { createLogger } from "../src/utils/logger.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { extractPdfKitText } from "./helpers/pdfText.js";
import {
  TEST_JWT_ACCESS_SECRET,
  TEST_JWT_REFRESH_SECRET,
  TEST_MFA_ENCRYPTION_KEY,
} from "./helpers/testApp.js";

const LOCAL_DEVELOPMENT_DATABASE_URL =
  "postgresql://wf_test:local_test_only@127.0.0.1:55432/wf_test_db";
const designatedDatabaseUrl =
  process.env["MONTHLY_ROSTER_PDF_DATABASE_URL"];
const databaseUrl =
  designatedDatabaseUrl ??
  (process.env["DATABASE_URL"] === LOCAL_DEVELOPMENT_DATABASE_URL
    ? LOCAL_DEVELOPMENT_DATABASE_URL
    : undefined);

function assertDisposableDatabaseUrl(connectionString: string): void {
  const url = new URL(connectionString);
  const databaseName = url.pathname.slice(1);
  const isAuthorisedLocalDatabase =
    url.hostname === "127.0.0.1" &&
    url.port === "55432" &&
    databaseName === "wf_test_db";
  const isAuthorisedCiDatabase =
    url.hostname === "localhost" &&
    url.port === "5432" &&
    databaseName === "verve_test_monthly_roster_pdf";
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    (!isAuthorisedLocalDatabase && !isAuthorisedCiDatabase)
  ) {
    throw new Error(
      "Monthly roster PDF PostgreSQL tests require an explicitly authorised disposable local database",
    );
  }
}

if (designatedDatabaseUrl) {
  assertDisposableDatabaseUrl(designatedDatabaseUrl);
}

function parseBuffer(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  response.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
  response.on("error", callback);
}

const canRun = databaseUrl !== undefined;

describe("monthly roster PDF composed PostgreSQL export", () => {
  if (!canRun) {
    it.skip(
      "Skipped locally: set MONTHLY_ROSTER_PDF_DATABASE_URL to an authorised disposable database",
      () => undefined,
    );
    return;
  }

  const month = "2037-07";
  const selectedShiftId = randomUUID();
  const cancelledShiftId = randomUUID();
  const siblingShiftId = randomUUID();
  const approvedLeaveId = randomUUID();
  const pendingLeaveId = randomUUID();
  const rejectedLeaveId = randomUUID();
  const withdrawnLeaveId = randomUUID();
  const otherOrganisationId = randomUUID();
  const otherOrganisationClinicId = randomUUID();
  let app: Express;
  let deps: AppDependencies | undefined;
  let ownerToken: string;
  let managerToken: string;
  let previousStaffDisplayName: string | null = null;
  let previousManagerDisplayName: string | null = null;
  let previousManagerTotpSecret: string | null = null;
  let previousOwnerTotpSecret: string | null = null;
  let previousManagerMfaEnabled = false;
  let previousOwnerMfaEnabled = false;
  let previousLogo: {
    imageData: Buffer;
    mimeType: string;
    sha256Checksum: string;
    width: number;
    height: number;
    updatedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null = null;
  let addedHomeRosterGrantId: string | null = null;

  beforeAll(async () => {
    assertDisposableDatabaseUrl(databaseUrl);
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_SSL = "false";
    process.env.MIGRATE_ON_STARTUP = "false";
    process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
    process.env.CORS_ORIGIN = "http://localhost:5173";
    process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
    delete process.env.REDIS_URL;

    const config = loadConfig();
    const logger = createLogger(config);
    deps = await createAppDependencies(config, logger);
    if (!deps.databasePool) {
      throw new Error("Expected a real PostgreSQL dependency pool");
    }
    app = createApp(config, logger, deps);
    const pool = deps.databasePool;

    const target = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(target.rows[0]?.database_name).toBe(
      new URL(databaseUrl).pathname.slice(1),
    );

    await pool.query(
      "INSERT INTO organisations (id, name) VALUES ($1, $2)",
      [otherOrganisationId, `Monthly PDF Other Org ${otherOrganisationId}`],
    );
    await pool.query(
      `INSERT INTO clinics
         (id, name, timezone, subscription_tier, is_active, organisation_id)
       VALUES ($1, 'Monthly PDF Other Organisation Clinic',
               'Australia/Melbourne', 'standard', true, $2)`,
      [otherOrganisationClinicId, otherOrganisationId],
    );

    await withTenantContext(
      pool,
      AUTH_BYPASS_CLINIC_ID,
      async (client) => {
        const users = await client.query<{
          id: string;
          display_name: string | null;
          totp_secret: string | null;
          mfa_enabled: boolean;
        }>(
          `SELECT id, display_name, totp_secret, mfa_enabled
             FROM users
            WHERE id = ANY($1::uuid[])`,
          [[
            SEED_USER_IDS.clinicAStaff,
            SEED_USER_IDS.clinicAManager,
            SEED_USER_IDS.clinicAAdmin,
          ]],
        );
        if (users.rows.length !== 3) {
          throw new Error("Expected seeded owner, manager and staff users");
        }
        const staff = users.rows.find(
          (row) => row.id === SEED_USER_IDS.clinicAStaff,
        );
        const manager = users.rows.find(
          (row) => row.id === SEED_USER_IDS.clinicAManager,
        );
        const owner = users.rows.find(
          (row) => row.id === SEED_USER_IDS.clinicAAdmin,
        );
        previousStaffDisplayName = staff?.display_name ?? null;
        previousManagerDisplayName = manager?.display_name ?? null;
        previousManagerTotpSecret = manager?.totp_secret ?? null;
        previousOwnerTotpSecret = owner?.totp_secret ?? null;
        previousManagerMfaEnabled = manager?.mfa_enabled ?? false;
        previousOwnerMfaEnabled = owner?.mfa_enabled ?? false;
        await client.query(
          `UPDATE users
              SET display_name = CASE id
                WHEN $1 THEN 'PG Monthly Alpha'
                WHEN $2 THEN 'PG Monthly Leave'
              END
            WHERE id = ANY($3::uuid[])`,
          [
            SEED_USER_IDS.clinicAStaff,
            SEED_USER_IDS.clinicAManager,
            [SEED_USER_IDS.clinicAStaff, SEED_USER_IDS.clinicAManager],
          ],
        );
        const encryptedTotp = encryptTotpSecret(
          SEED_ADMIN_TOTP_SECRET,
          TEST_MFA_ENCRYPTION_KEY,
        );
        await client.query(
          `UPDATE users
              SET mfa_enabled = true, totp_secret = $1
            WHERE id = ANY($2::uuid[])`,
          [
            encryptedTotp,
            [SEED_USER_IDS.clinicAManager, SEED_USER_IDS.clinicAAdmin],
          ],
        );
      },
      true,
    );

    const selectedLogo = await sharp({
      create: {
        width: 23,
        height: 17,
        channels: 3,
        background: "#253b63",
      },
    }).png().toBuffer();
    await withTenantContext(pool, SEED_CLINIC_A_ID, async (client) => {
      const existingLogo = await client.query<{
        image_data: Buffer;
        mime_type: string;
        sha256_checksum: string;
        width: number;
        height: number;
        updated_by_user_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT image_data, mime_type, sha256_checksum, width, height,
                updated_by_user_id, created_at, updated_at
           FROM clinic_brand_assets
          WHERE clinic_id = $1`,
        [SEED_CLINIC_A_ID],
      );
      const row = existingLogo.rows[0];
      previousLogo = row
        ? {
            imageData: row.image_data,
            mimeType: row.mime_type,
            sha256Checksum: row.sha256_checksum,
            width: row.width,
            height: row.height,
            updatedByUserId: row.updated_by_user_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : null;
      await client.query(
        `INSERT INTO roster_entries
           (id, staff_user_id, staff_email, rostered_clinic_id,
            rostered_clinic_name, shift_start_at, shift_end_at, shift_type,
            notes, status, created_by_user_id)
         VALUES
           ($1, $2, 'staff@clinic-a.au', $3, 'Verve Dental Clinic A',
            '2037-07-06T09:00:00+10:00', '2037-07-06T17:00:00+10:00',
            'standard', 'PG monthly private note', 'scheduled', $4),
           ($5, $2, 'staff@clinic-a.au', $3, 'Verve Dental Clinic A',
            '2037-07-07T01:11:00+10:00', '2037-07-07T02:22:00+10:00',
            'standard', 'PG monthly cancelled secret', 'cancelled', $4)`,
        [
          selectedShiftId,
          SEED_USER_IDS.clinicAStaff,
          SEED_CLINIC_A_ID,
          SEED_USER_IDS.clinicAManager,
          cancelledShiftId,
        ],
      );
      await client.query(
        `INSERT INTO clinic_brand_assets
           (clinic_id, image_data, mime_type, sha256_checksum, width, height,
            updated_by_user_id)
         VALUES ($1, $2, 'image/png', $3, 23, 17, $4)
         ON CONFLICT (clinic_id) DO UPDATE
           SET image_data = EXCLUDED.image_data,
               mime_type = EXCLUDED.mime_type,
               sha256_checksum = EXCLUDED.sha256_checksum,
               width = EXCLUDED.width,
               height = EXCLUDED.height,
               updated_by_user_id = EXCLUDED.updated_by_user_id,
               updated_at = now()`,
        [
          SEED_CLINIC_A_ID,
          selectedLogo,
          createHash("sha256").update(selectedLogo).digest("hex"),
          SEED_USER_IDS.clinicAManager,
        ],
      );
    });

    await withTenantContext(pool, SEED_CLINIC_B_ID, async (client) => {
      await client.query(
        `INSERT INTO roster_entries
           (id, staff_user_id, staff_email, rostered_clinic_id,
            rostered_clinic_name, shift_start_at, shift_end_at, shift_type,
            notes, status, created_by_user_id)
         VALUES ($1, $2, 'staff@clinic-a.au', $3, 'Verve Dental Clinic B',
                 '2037-07-08T03:21:00+10:00', '2037-07-08T04:21:00+10:00',
                 'standard', 'PG monthly sibling secret', 'scheduled', $4)`,
        [
          siblingShiftId,
          SEED_USER_IDS.clinicAStaff,
          SEED_CLINIC_B_ID,
          SEED_USER_IDS.clinicAManager,
        ],
      );
    });

    await withTenantContext(pool, SEED_CLINIC_A_ID, async (client) => {
      // Remove only stale records owned by this suite, including remnants from
      // an interrupted local run, so the composed-content assertions stay exact.
      await client.query(
        `DELETE FROM leave_requests
          WHERE clinic_id = $1
            AND reason IN (
              'PG monthly confidential approved reason',
              'PG monthly confidential pending reason',
              'PG monthly confidential rejected reason',
              'PG monthly confidential withdrawn reason'
            )`,
        [SEED_CLINIC_A_ID],
      );
      await client.query(
        `INSERT INTO leave_requests
           (id, staff_user_id, staff_email, clinic_id, leave_type, start_date,
            end_date, total_days, reason, status, reviewed_by_user_id,
            reviewed_at)
         VALUES
           ($1, $2, 'manager@clinic-a.au', $3, 'annual', '2037-07-09',
            '2037-07-09', 1, 'PG monthly confidential approved reason',
            'approved', $4, now()),
           ($5, $6, 'staff@clinic-a.au', $3, 'sick', '2037-07-10',
            '2037-07-10', 1, 'PG monthly confidential pending reason',
            'pending', NULL, NULL),
           ($7, $6, 'staff@clinic-a.au', $3, 'annual', '2037-07-11',
            '2037-07-11', 1, 'PG monthly confidential rejected reason',
            'rejected', $4, now()),
           ($8, $6, 'staff@clinic-a.au', $3, 'annual', '2037-07-12',
            '2037-07-12', 1, 'PG monthly confidential withdrawn reason',
            'withdrawn', NULL, NULL)`,
        [
          approvedLeaveId,
          SEED_USER_IDS.clinicAManager,
          SEED_CLINIC_A_ID,
          SEED_USER_IDS.clinicAAdmin,
          pendingLeaveId,
          SEED_USER_IDS.clinicAStaff,
          rejectedLeaveId,
          withdrawnLeaveId,
        ],
      );
    });

    const homePermissions =
      await deps.permissionRepository.listActiveByUserForClinic(
        SEED_USER_IDS.clinicAManager,
        SEED_CLINIC_A_ID,
      );
    if (!homePermissions.includes("module:roster")) {
      const grant = await deps.permissionRepository.grant(
        SEED_CLINIC_A_ID,
        SEED_USER_IDS.clinicAManager,
        "module:roster",
        SEED_USER_IDS.clinicAAdmin,
      );
      addedHomeRosterGrantId = grant.id;
    }
    ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
  }, 30_000);

  afterAll(async () => {
    if (!deps?.databasePool) return;
    const pool = deps.databasePool;
    await withTenantContext(
      pool,
      AUTH_BYPASS_CLINIC_ID,
      async (client) => {
        await client.query(
          `UPDATE users
              SET display_name = CASE id
                    WHEN $1 THEN $3
                    WHEN $2 THEN $4
                  END
            WHERE id = ANY($5::uuid[])`,
          [
            SEED_USER_IDS.clinicAStaff,
            SEED_USER_IDS.clinicAManager,
            previousStaffDisplayName,
            previousManagerDisplayName,
            [SEED_USER_IDS.clinicAStaff, SEED_USER_IDS.clinicAManager],
          ],
        );
        await client.query(
          `UPDATE users
              SET mfa_enabled = CASE id
                    WHEN $1 THEN $3
                    WHEN $2 THEN $4
                  END,
                  totp_secret = CASE id
                    WHEN $1 THEN $5
                    WHEN $2 THEN $6
                  END
            WHERE id = ANY($7::uuid[])`,
          [
            SEED_USER_IDS.clinicAManager,
            SEED_USER_IDS.clinicAAdmin,
            previousManagerMfaEnabled,
            previousOwnerMfaEnabled,
            previousManagerTotpSecret,
            previousOwnerTotpSecret,
            [SEED_USER_IDS.clinicAManager, SEED_USER_IDS.clinicAAdmin],
          ],
        );
        if (addedHomeRosterGrantId) {
          await client.query(
            "DELETE FROM user_permission_grants WHERE id = $1",
            [addedHomeRosterGrantId],
          );
        }
      },
      true,
    ).catch(() => undefined);

    await withTenantContext(pool, SEED_CLINIC_A_ID, async (client) => {
      await client.query(
        "DELETE FROM leave_requests WHERE id = ANY($1::uuid[])",
        [[
          approvedLeaveId,
          pendingLeaveId,
          rejectedLeaveId,
          withdrawnLeaveId,
        ]],
      );
      await client.query(
        "DELETE FROM roster_entries WHERE id = ANY($1::uuid[])",
        [[selectedShiftId, cancelledShiftId]],
      );
      await client.query(
        "DELETE FROM clinic_brand_assets WHERE clinic_id = $1",
        [SEED_CLINIC_A_ID],
      );
      if (previousLogo) {
        await client.query(
          `INSERT INTO clinic_brand_assets
             (clinic_id, image_data, mime_type, sha256_checksum, width, height,
              updated_by_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            SEED_CLINIC_A_ID,
            previousLogo.imageData,
            previousLogo.mimeType,
            previousLogo.sha256Checksum,
            previousLogo.width,
            previousLogo.height,
            previousLogo.updatedByUserId,
            previousLogo.createdAt,
            previousLogo.updatedAt,
          ],
        );
      }
    }).catch(() => undefined);
    await withTenantContext(pool, SEED_CLINIC_B_ID, async (client) => {
      await client.query(
        "DELETE FROM roster_entries WHERE id = $1",
        [siblingShiftId],
      );
    }).catch(() => undefined);
    await pool.query(
      "DELETE FROM clinics WHERE id = $1",
      [otherOrganisationClinicId],
    ).catch(() => undefined);
    await pool.query(
      "DELETE FROM organisations WHERE id = $1",
      [otherOrganisationId],
    ).catch(() => undefined);
    await deps.shutdown();
  });

  it("exports exact-clinic PostgreSQL shifts, approved leave and branding without sensitive data", async () => {
    const response = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/monthly.pdf?month=${month}&paperSize=A3`,
      )
      .set("Authorization", `Bearer ${managerToken}`)
      .buffer(true)
      .parse(parseBuffer);
    if (response.status !== 200) {
      throw new Error(
        `Expected monthly PostgreSQL export 200, received ${String(response.status)}: ${(response.body as Buffer).toString("utf8")}`,
      );
    }
    expect(response.headers["x-export-shift-count"]).toBe("1");
    expect(response.headers["x-export-entry-count"]).toBe("2");
    const pdf = response.body as Buffer;
    const text = extractPdfKitText(pdf);
    expect(text).toContain("PG Monthly Alpha");
    expect(text).toContain("09:00–17:00");
    expect(text).toContain("PG Monthly Leave — Leave");
    expect(text).not.toContain("PG Monthly Alpha — Leave");
    expect(text).not.toMatch(
      /01:11|02:22|03:21|04:21|cancelled secret|sibling secret|confidential (approved|pending|rejected|withdrawn) reason|staff@clinic-a\.au|manager@clinic-a\.au/i,
    );
    const rawPdf = pdf.toString("latin1");
    expect(rawPdf).toMatch(/\/Subtype\s*\/Image[\s\S]{0,300}\/Width\s+23\b/);
  });

  it("rejects an unassigned sibling clinic and another organisation", async () => {
    expect(
      (await request(app)
        .get(
          `/api/v1/clinics/${SEED_CLINIC_B_ID}/roster/monthly.pdf?month=${month}`,
        )
        .set("Authorization", `Bearer ${managerToken}`)).status,
    ).toBe(403);
    const otherOrganisationResponse = await request(app)
      .get(
        `/api/v1/clinics/${otherOrganisationClinicId}/roster/monthly.pdf?month=${month}`,
      )
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(otherOrganisationResponse.status).toBe(403);
    expect(
      (otherOrganisationResponse.body as { error: { code: string } }).error.code,
    ).toBe("TENANT_ACCESS_DENIED");
  });
});
