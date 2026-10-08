import { randomUUID } from "node:crypto";
import pg from "pg";

import type { DatabasePool } from "../src/db/pool.js";
import { createPostgresLeaveRepository } from "../src/repositories/leaveRepository.postgres.js";
import { createPostgresUserRepository } from "../src/repositories/userRepository.postgres.js";

const DB_URL = process.env["TEST_DATABASE_URL"];

describe("sole owner leave review organisation scope (Postgres)", () => {
  if (!DB_URL) {
    it.skip("TEST_DATABASE_URL not configured", () => undefined);
    return;
  }

  let pool: DatabasePool;
  const targetOrganisationId = randomUUID();
  const otherOrganisationId = randomUUID();
  const targetClinicId = randomUUID();
  const siblingClinicId = randomUUID();
  const otherClinicId = randomUUID();
  const nullOrganisationClinicId = randomUUID();
  const actorId = randomUUID();

  const userIds = new Set<string>([actorId]);
  const leaveIds = new Set<string>();
  const cancellationIds = new Set<string>();

  beforeAll(() => {
    const parsed = new URL(DB_URL);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new Error("Sole-owner integration tests require an isolated local test database");
    }
    pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
  });

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO organisations (id, name) VALUES ($1, 'Sole owner target'), ($2, 'Sole owner other')`,
      [targetOrganisationId, otherOrganisationId],
    );
    await pool.query(
      `INSERT INTO clinics (id, name, organisation_id)
       VALUES ($1, 'Target clinic', $5),
              ($2, 'Sibling clinic', $5),
              ($3, 'Other clinic', $6),
              ($4, 'Null organisation clinic', NULL)`,
      [
        targetClinicId,
        siblingClinicId,
        otherClinicId,
        nullOrganisationClinicId,
        targetOrganisationId,
        otherOrganisationId,
      ],
    );
    await insertUser(actorId, "owner_admin", targetClinicId);
  });

  afterEach(async () => {
    await pool.query(
      "DELETE FROM leave_cancellation_requests WHERE id = ANY($1::uuid[])",
      [[...cancellationIds]],
    );
    await pool.query("DELETE FROM leave_requests WHERE id = ANY($1::uuid[])", [[...leaveIds]]);
    await pool.query(
      "DELETE FROM user_permission_grants WHERE user_id = ANY($1::uuid[]) OR granted_by = ANY($1::uuid[])",
      [[...userIds]],
    );
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[...userIds]]);
    await pool.query(
      "DELETE FROM clinics WHERE id = ANY($1::uuid[])",
      [[targetClinicId, siblingClinicId, otherClinicId, nullOrganisationClinicId]],
    );
    await pool.query(
      "DELETE FROM organisations WHERE id = ANY($1::uuid[])",
      [[targetOrganisationId, otherOrganisationId]],
    );
    userIds.clear();
    userIds.add(actorId);
    leaveIds.clear();
    cancellationIds.clear();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertUser(
    id: string,
    role: "owner_admin" | "group_practice_manager",
    homeClinicId: string,
    isActive = true,
  ): Promise<void> {
    userIds.add(id);
    await pool.query(
      `INSERT INTO users
         (id, email, password_hash, role, home_clinic_id, home_clinic_name, is_active)
       VALUES ($1, $2, 'integration-test-hash', $3, $4, 'Integration clinic', $5)`,
      [id, `${id}@example.test`, role, homeClinicId, isActive],
    );
  }

  async function insertApprovedOwnerLeave(): Promise<{ leaveId: string; requestId: string }> {
    const leaveId = randomUUID();
    const requestId = randomUUID();
    leaveIds.add(leaveId);
    cancellationIds.add(requestId);
    await pool.query(
      `INSERT INTO leave_requests
         (id, staff_user_id, staff_email, clinic_id, leave_type,
          start_date, end_date, total_days, status, reviewed_by_user_id, reviewed_at)
       VALUES ($1, $2, $3, $4, 'annual', '2036-01-12', '2036-01-12', 1,
               'approved', $2, now())`,
      [leaveId, actorId, `${actorId}@example.test`, targetClinicId],
    );
    await pool.query(
      `INSERT INTO leave_cancellation_requests
         (id, leave_request_id, clinic_id, staff_user_id, requested_by_user_id, request_reason)
       VALUES ($1, $2, $3, $4, $4, 'Plans changed')`,
      [requestId, leaveId, targetClinicId, actorId],
    );
    return { leaveId, requestId };
  }

  it("allows one active owner whose home clinic belongs to the target organisation", async () => {
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        targetClinicId,
        actorId,
      ),
    ).resolves.toBe(true);
  });

  it("rejects when a second active owner belongs to the same organisation", async () => {
    await insertUser(randomUUID(), "owner_admin", siblingClinicId);
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        targetClinicId,
        actorId,
      ),
    ).resolves.toBe(false);
  });

  it("ignores an active owner from another organisation", async () => {
    await insertUser(randomUUID(), "owner_admin", otherClinicId);
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        targetClinicId,
        actorId,
      ),
    ).resolves.toBe(true);
  });

  it("ignores an inactive same-organisation owner", async () => {
    await insertUser(randomUUID(), "owner_admin", siblingClinicId, false);
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        targetClinicId,
        actorId,
      ),
    ).resolves.toBe(true);
  });

  it("never allows an ordinary GPM actor", async () => {
    const gpmId = randomUUID();
    await insertUser(gpmId, "group_practice_manager", targetClinicId);
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        targetClinicId,
        gpmId,
      ),
    ).resolves.toBe(false);
  });

  it("fails closed when the target clinic has no organisation", async () => {
    const nullOrganisationOwnerId = randomUUID();
    await insertUser(nullOrganisationOwnerId, "owner_admin", nullOrganisationClinicId);
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        nullOrganisationClinicId,
        nullOrganisationOwnerId,
      ),
    ).resolves.toBe(false);
  });

  it("counts an active target-clinic GPM with module:leave as another reviewer", async () => {
    const gpmId = randomUUID();
    await insertUser(gpmId, "group_practice_manager", targetClinicId);
    await pool.query(
      `INSERT INTO user_permission_grants (clinic_id, user_id, permission, granted_by)
       VALUES ($1, $2, 'module:leave', $3)`,
      [targetClinicId, gpmId, actorId],
    );
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        targetClinicId,
        actorId,
      ),
    ).resolves.toBe(false);
  });

  it("ignores a target-clinic GPM whose module:leave grant is for another clinic", async () => {
    const gpmId = randomUUID();
    await insertUser(gpmId, "group_practice_manager", targetClinicId);
    await pool.query(
      `INSERT INTO user_permission_grants (clinic_id, user_id, permission, granted_by)
       VALUES ($1, $2, 'module:leave', $3)`,
      [siblingClinicId, gpmId, actorId],
    );
    await expect(
      createPostgresUserRepository(pool).canUseSoleOwnerAdminLeaveReviewException(
        targetClinicId,
        actorId,
      ),
    ).resolves.toBe(true);
  });

  it("allows the sole eligible owner exception to complete against PostgreSQL", async () => {
    const { leaveId, requestId } = await insertApprovedOwnerLeave();
    const result = await createPostgresLeaveRepository(pool).approveCancellationRequest({
      requestId,
      leaveId,
      clinicId: targetClinicId,
      expectedStaffUserId: actorId,
      reviewedByUserId: actorId,
      reviewNotes: "Sole eligible reviewer",
      selfReviewExceptionUsed: true,
    });
    expect(result.request).toMatchObject({
      status: "approved",
      selfReviewExceptionUsed: true,
    });
    expect(result.leave).toMatchObject({
      status: "cancelled",
      cancellationSelfReviewExceptionUsed: true,
    });
  });

  it("transactional revalidation ignores an owner from another organisation", async () => {
    const { leaveId, requestId } = await insertApprovedOwnerLeave();
    await insertUser(randomUUID(), "owner_admin", otherClinicId);

    const result = await createPostgresLeaveRepository(pool).approveCancellationRequest({
      requestId,
      leaveId,
      clinicId: targetClinicId,
      expectedStaffUserId: actorId,
      reviewedByUserId: actorId,
      reviewNotes: "Other-organisation owner is not a reviewer",
      selfReviewExceptionUsed: true,
    });

    expect(result.request.status).toBe("approved");
    expect(result.leave.status).toBe("cancelled");
  });

  it("revalidates organisation scope and preserves both rows if a same-org owner appears", async () => {
    const userRepository = createPostgresUserRepository(pool);
    await expect(
      userRepository.canUseSoleOwnerAdminLeaveReviewException(targetClinicId, actorId),
    ).resolves.toBe(true);
    const { leaveId, requestId } = await insertApprovedOwnerLeave();
    await insertUser(randomUUID(), "owner_admin", siblingClinicId);

    await expect(
      createPostgresLeaveRepository(pool).approveCancellationRequest({
        requestId,
        leaveId,
        clinicId: targetClinicId,
        expectedStaffUserId: actorId,
        reviewedByUserId: actorId,
        reviewNotes: "Stale precheck",
        selfReviewExceptionUsed: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SELF_REVIEW_FORBIDDEN",
    });

    const persisted = await pool.query<{
      parent_status: string;
      cancelled_by_user_id: string | null;
      cancellation_self_review_exception_used: boolean;
      child_status: string;
      reviewed_by_user_id: string | null;
      self_review_exception_used: boolean;
    }>(
      `SELECT l.status::text AS parent_status,
              l.cancelled_by_user_id,
              l.cancellation_self_review_exception_used,
              c.status::text AS child_status,
              c.reviewed_by_user_id,
              c.self_review_exception_used
         FROM leave_requests l
         JOIN leave_cancellation_requests c ON c.leave_request_id = l.id
        WHERE l.id = $1 AND c.id = $2`,
      [leaveId, requestId],
    );
    expect(persisted.rows[0]).toEqual({
      parent_status: "approved",
      cancelled_by_user_id: null,
      cancellation_self_review_exception_used: false,
      child_status: "pending",
      reviewed_by_user_id: null,
      self_review_exception_used: false,
    });
  });
});
