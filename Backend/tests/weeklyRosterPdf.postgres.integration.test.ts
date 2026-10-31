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
import { SEED_ORGANISATION_ID } from "../src/repositories/organisationRepository.js";
import {
  SEED_ADMIN_TOTP_SECRET,
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { createLogger } from "../src/utils/logger.js";
import { encryptTotpSecret } from "../src/utils/mfaCrypto.js";
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
  process.env["WEEKLY_ROSTER_PDF_DATABASE_URL"];
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
    databaseName === "verve_test_weekly_roster_pdf";
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    (!isAuthorisedLocalDatabase && !isAuthorisedCiDatabase)
  ) {
    throw new Error(
      "Weekly roster PDF PostgreSQL tests require an explicitly authorised disposable local database",
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

describe("weekly roster PDF composed PostgreSQL export", () => {
  if (!canRun) {
    it.skip(
      "Skipped locally: set WEEKLY_ROSTER_PDF_DATABASE_URL to an authorised disposable database",
      () => undefined,
    );
    return;
  }

  const selectedClinicId = randomUUID();
  const siblingClinicId = randomUUID();
  const otherOrganisationId = randomUUID();
  const otherOrganisationClinicId = randomUUID();
  const selectedShiftId = randomUUID();
  const cancelledShiftId = randomUUID();
  const siblingShiftId = randomUUID();
  const approvedLeaveId = randomUUID();
  const pendingLeaveId = randomUUID();
  const selectedClinicName = `PG Weekly Export ${selectedClinicId.slice(0, 8)}`;
  let app: Express;
  let deps: AppDependencies | undefined;
  let managerToken: string;
  let ownerToken: string;
  let previousStaffDisplayName: string | null = null;
  let previousManagerDisplayName: string | null = null;
  let previousManagerTotpSecret: string | null = null;
  let previousOwnerTotpSecret: string | null = null;
  let previousManagerMfaEnabled = false;
  let previousOwnerMfaEnabled = false;
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
      [otherOrganisationId, `PG PDF Other Organisation ${otherOrganisationId}`],
    );
    for (const [clinicId, name, organisationId] of [
      [selectedClinicId, selectedClinicName, SEED_ORGANISATION_ID],
      [siblingClinicId, "PG Sibling Secret Clinic", SEED_ORGANISATION_ID],
      [
        otherOrganisationClinicId,
        "PG Other Organisation Secret Clinic",
        otherOrganisationId,
      ],
    ] as const) {
      await pool.query(
        `INSERT INTO clinics
           (id, name, timezone, subscription_tier, is_active, organisation_id)
         VALUES ($1, $2, 'Australia/Melbourne', 'standard', true, $3)`,
        [clinicId, name, organisationId],
      );
    }

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
          throw new Error("Expected seeded owner, manager and staff PostgreSQL users");
        }
        previousStaffDisplayName =
          users.rows.find((row) => row.id === SEED_USER_IDS.clinicAStaff)
            ?.display_name ?? null;
        previousManagerDisplayName =
          users.rows.find((row) => row.id === SEED_USER_IDS.clinicAManager)
            ?.display_name ?? null;
        const manager = users.rows.find(
          (row) => row.id === SEED_USER_IDS.clinicAManager,
        );
        const owner = users.rows.find(
          (row) => row.id === SEED_USER_IDS.clinicAAdmin,
        );
        previousManagerTotpSecret = manager?.totp_secret ?? null;
        previousOwnerTotpSecret = owner?.totp_secret ?? null;
        previousManagerMfaEnabled = manager?.mfa_enabled ?? false;
        previousOwnerMfaEnabled = owner?.mfa_enabled ?? false;
        await client.query(
          `UPDATE users
              SET display_name = CASE id
                WHEN $1 THEN 'PG Export Alpha'
                WHEN $2 THEN 'PG Approved Leave'
              END
            WHERE id = ANY($3::uuid[])`,
          [
            SEED_USER_IDS.clinicAStaff,
            SEED_USER_IDS.clinicAManager,
            [SEED_USER_IDS.clinicAStaff, SEED_USER_IDS.clinicAManager],
          ],
        );
        const encryptedTotpSecret = encryptTotpSecret(
          SEED_ADMIN_TOTP_SECRET,
          TEST_MFA_ENCRYPTION_KEY,
        );
        await client.query(
          `UPDATE users
              SET mfa_enabled = true, totp_secret = $1
            WHERE id = ANY($2::uuid[])`,
          [
            encryptedTotpSecret,
            [SEED_USER_IDS.clinicAManager, SEED_USER_IDS.clinicAAdmin],
          ],
        );
      },
      true,
    );

    const selectedLogo = await sharp({
      create: {
        width: 17,
        height: 11,
        channels: 3,
        background: "#253b63",
      },
    }).png().toBuffer();
    const siblingLogo = await sharp({
      create: {
        width: 19,
        height: 13,
        channels: 3,
        background: "#ff0000",
      },
    }).png().toBuffer();

    await withTenantContext(pool, selectedClinicId, async (client) => {
      for (const userId of [
        SEED_USER_IDS.clinicAStaff,
        SEED_USER_IDS.clinicAManager,
      ]) {
        await client.query(
          `INSERT INTO user_clinic_assignments
             (user_id, clinic_id, can_roster, can_operate, assigned_at)
           VALUES ($1, $2, true, true, now())`,
          [userId, selectedClinicId],
        );
      }
      await client.query(
        `INSERT INTO roster_entries
           (id, staff_user_id, staff_email, rostered_clinic_id,
            rostered_clinic_name, shift_start_at, shift_end_at, shift_type,
            notes, status, created_by_user_id)
         VALUES
           ($1, $2, 'staff@clinic-a.au', $3, $4,
            '2026-11-16T09:00:00+11:00', '2026-11-16T17:00:00+11:00',
            'standard', 'PG private roster note', 'scheduled', $5),
           ($6, $2, 'staff@clinic-a.au', $3, $4,
            '2026-11-17T01:11:00+11:00', '2026-11-17T02:22:00+11:00',
            'standard', 'PG cancelled secret', 'cancelled', $5)`,
        [
          selectedShiftId,
          SEED_USER_IDS.clinicAStaff,
          selectedClinicId,
          selectedClinicName,
          SEED_USER_IDS.clinicAManager,
          cancelledShiftId,
        ],
      );
      await client.query(
        `INSERT INTO clinic_brand_assets
           (clinic_id, image_data, mime_type, sha256_checksum, width, height,
            updated_by_user_id)
         VALUES ($1, $2, 'image/png', $3, 17, 11, $4)`,
        [
          selectedClinicId,
          selectedLogo,
          createHash("sha256").update(selectedLogo).digest("hex"),
          SEED_USER_IDS.clinicAManager,
        ],
      );
    });

    await withTenantContext(pool, siblingClinicId, async (client) => {
      await client.query(
        `INSERT INTO roster_entries
           (id, staff_user_id, staff_email, rostered_clinic_id,
            rostered_clinic_name, shift_start_at, shift_end_at, shift_type,
            notes, status, created_by_user_id)
         VALUES ($1, $2, 'staff@clinic-a.au', $3, 'PG Sibling Secret Clinic',
                 '2026-11-18T03:21:00+11:00', '2026-11-18T04:21:00+11:00',
                 'standard', 'PG sibling secret note', 'scheduled', $4)`,
        [
          siblingShiftId,
          SEED_USER_IDS.clinicAStaff,
          siblingClinicId,
          SEED_USER_IDS.clinicAManager,
        ],
      );
      await client.query(
        `INSERT INTO clinic_brand_assets
           (clinic_id, image_data, mime_type, sha256_checksum, width, height,
            updated_by_user_id)
         VALUES ($1, $2, 'image/png', $3, 19, 13, $4)`,
        [
          siblingClinicId,
          siblingLogo,
          createHash("sha256").update(siblingLogo).digest("hex"),
          SEED_USER_IDS.clinicAManager,
        ],
      );
    });

    await withTenantContext(pool, SEED_CLINIC_A_ID, async (client) => {
      await client.query(
        `INSERT INTO leave_requests
           (id, staff_user_id, staff_email, clinic_id, leave_type, start_date,
            end_date, total_days, reason, status, reviewed_by_user_id,
            reviewed_at)
         VALUES
           ($1, $2, 'manager@clinic-a.au', $3, 'annual', '2026-11-19',
            '2026-11-19', 1, 'PG confidential approved reason', 'approved',
            $4, now()),
           ($5, $6, 'staff@clinic-a.au', $3, 'sick', '2026-11-20',
            '2026-11-20', 1, 'PG confidential pending reason', 'pending',
            NULL, NULL)`,
        [
          approvedLeaveId,
          SEED_USER_IDS.clinicAManager,
          SEED_CLINIC_A_ID,
          SEED_USER_IDS.clinicAAdmin,
          pendingLeaveId,
          SEED_USER_IDS.clinicAStaff,
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
    managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
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
        await client.query(
          "DELETE FROM leave_requests WHERE id = ANY($1::uuid[])",
          [[approvedLeaveId, pendingLeaveId]],
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
    for (const clinicId of [selectedClinicId, siblingClinicId]) {
      await withTenantContext(pool, clinicId, async (client) => {
        await client.query(
          "DELETE FROM roster_entries WHERE id = ANY($1::uuid[])",
          [[selectedShiftId, cancelledShiftId, siblingShiftId]],
        );
        await client.query(
          "DELETE FROM user_clinic_assignments WHERE clinic_id = $1",
          [clinicId],
        );
        await client.query(
          "DELETE FROM user_permission_grants WHERE clinic_id = $1",
          [clinicId],
        );
        await client.query(
          "DELETE FROM clinic_brand_assets WHERE clinic_id = $1",
          [clinicId],
        );
      }, true).catch(() => undefined);
    }
    await pool.query(
      "DELETE FROM clinics WHERE id = ANY($1::uuid[])",
      [[selectedClinicId, siblingClinicId, otherOrganisationClinicId]],
    ).catch(() => undefined);
    await pool.query(
      "DELETE FROM organisations WHERE id = $1",
      [otherOrganisationId],
    ).catch(() => undefined);
    await deps.shutdown();
  });

  it("exports exact-clinic PostgreSQL roster, approved leave and logo without sensitive or sibling data", async () => {
    const response = await request(app)
      .get(
        `/api/v1/clinics/${selectedClinicId}/roster/export.pdf?weekStart=2026-11-16`,
      )
      .set("Authorization", `Bearer ${managerToken}`)
      .buffer(true)
      .parse(parseBuffer);

    if (response.status !== 200) {
      const body = response.body as Buffer;
      throw new Error(
        `Expected PostgreSQL PDF export 200, received ${String(response.status)}: ${body.toString("utf8")}`,
      );
    }
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="RENQOR_[^"]+\.pdf"$/,
    );
    expect(response.headers["x-export-staff-count"]).toBe("2");
    expect(response.headers["x-export-shift-count"]).toBe("1");
    expect(Buffer.isBuffer(response.body)).toBe(true);
    const pdf = response.body as Buffer;
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const text = extractPdfKitText(pdf);
    expect(text).toContain(selectedClinicName);
    expect(text).toContain("PG Export Alpha");
    expect(text).toContain("PG Approved Leave");
    expect(text).toContain("09:00-17:00");
    expect(text).toContain("Approved Leave");
    expect(text).not.toMatch(
      /01:11-02:22|03:21-04:21|PG cancelled secret|PG sibling secret|confidential approved reason|confidential pending reason|staff@clinic-a\.au|manager@clinic-a\.au/i,
    );
    const rawPdf = pdf.toString("latin1");
    expect(rawPdf).toMatch(/\/Subtype\s*\/Image[\s\S]{0,300}\/Width\s+17\b/);
    expect(rawPdf).not.toMatch(/\/Subtype\s*\/Image[\s\S]{0,300}\/Width\s+19\b/);
  });

  it("rejects an unassigned sibling clinic and another organisation", async () => {
    const siblingResponse = await request(app)
      .get(
        `/api/v1/clinics/${siblingClinicId}/roster/export.pdf?weekStart=2026-11-16`,
      )
      .set("Authorization", `Bearer ${managerToken}`);
    expect(siblingResponse.status).toBe(403);

    const otherOrganisationResponse = await request(app)
      .get(
        `/api/v1/clinics/${otherOrganisationClinicId}/roster/export.pdf?weekStart=2026-11-16`,
      )
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(otherOrganisationResponse.status).toBe(403);
    expect(
      (otherOrganisationResponse.body as { error: { code: string } }).error.code,
    ).toBe("TENANT_ACCESS_DENIED");
  });
});
