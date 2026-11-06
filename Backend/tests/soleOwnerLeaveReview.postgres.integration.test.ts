import { randomUUID } from "node:crypto";
import pg from "pg";

import type { DatabasePool } from "../src/db/pool.js";
import { createPostgresLeaveRepository } from "../src/repositories/leaveRepository.postgres.js";

const DB_URL = process.env["TEST_DATABASE_URL"];

describe("leave cancellation independent review (Postgres)", () => {
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

  async function expectUnchanged(leaveId: string, requestId: string) {
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
  }

  it("rejects direct self-cancellation transactionally", async () => {
    const { leaveId } = await insertApprovedOwnerLeave();
    await pool.query("DELETE FROM leave_cancellation_requests WHERE leave_request_id = $1", [leaveId]);

    await expect(
      createPostgresLeaveRepository(pool).cancelApprovedLeave({
        leaveId,
        clinicId: targetClinicId,
        expectedStaffUserId: actorId,
        cancelledByUserId: actorId,
        cancellationReason: "Self cancellation attempt",
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "SELF_REVIEW_FORBIDDEN" });

    const persisted = await pool.query<{
      status: string;
      cancelled_by_user_id: string | null;
      cancellation_self_review_exception_used: boolean;
    }>(
      `SELECT status::text, cancelled_by_user_id, cancellation_self_review_exception_used
         FROM leave_requests WHERE id = $1`,
      [leaveId],
    );
    expect(persisted.rows[0]).toEqual({
      status: "approved",
      cancelled_by_user_id: null,
      cancellation_self_review_exception_used: false,
    });
  });

  it.each(["approve", "decline"] as const)(
    "rejects direct repository self-%s and preserves both locked rows",
    async (decision) => {
      const { leaveId, requestId } = await insertApprovedOwnerLeave();
      const repository = createPostgresLeaveRepository(pool);
      const input = {
        requestId,
        leaveId,
        clinicId: targetClinicId,
        expectedStaffUserId: actorId,
        reviewedByUserId: actorId,
        reviewNotes: decision === "approve" ? null : "Self decline attempt",
      };

      await expect(
        decision === "approve"
          ? repository.approveCancellationRequest(input)
          : repository.declineCancellationRequest(input),
      ).rejects.toMatchObject({ statusCode: 403, code: "SELF_REVIEW_FORBIDDEN" });
      await expectUnchanged(leaveId, requestId);
    },
  );

  it("preserves independent approval and writes false exception evidence", async () => {
    const reviewerId = randomUUID();
    await insertUser(reviewerId, "owner_admin", siblingClinicId);
    const { leaveId, requestId } = await insertApprovedOwnerLeave();

    const result = await createPostgresLeaveRepository(pool).approveCancellationRequest({
      requestId,
      leaveId,
      clinicId: targetClinicId,
      expectedStaffUserId: actorId,
      reviewedByUserId: reviewerId,
      reviewNotes: "Independent approval",
    });

    expect(result.request).toMatchObject({
      status: "approved",
      reviewedByUserId: reviewerId,
      selfReviewExceptionUsed: false,
    });
    expect(result.leave).toMatchObject({
      status: "cancelled",
      cancelledByUserId: reviewerId,
      cancellationSelfReviewExceptionUsed: false,
    });
  });

  it("continues to read historical exception evidence", async () => {
    const { leaveId, requestId } = await insertApprovedOwnerLeave();
    await pool.query(
      `UPDATE leave_cancellation_requests
          SET status = 'approved', reviewed_by_user_id = $3, reviewed_at = now(),
              self_review_exception_used = true
        WHERE id = $1 AND leave_request_id = $2`,
      [requestId, leaveId, actorId],
    );
    await pool.query(
      `UPDATE leave_requests
          SET status = 'cancelled', cancelled_by_user_id = $2, cancelled_at = now(),
              cancellation_reason = 'Historical exception',
              cancellation_self_review_exception_used = true
        WHERE id = $1`,
      [leaveId, actorId],
    );

    await expect(createPostgresLeaveRepository(pool).findById(leaveId)).resolves.toMatchObject({
      status: "cancelled",
      cancellationSelfReviewExceptionUsed: true,
    });
    await expect(createPostgresLeaveRepository(pool).findCancellationRequestById({
      requestId,
      leaveId,
      clinicId: targetClinicId,
    })).resolves.toMatchObject({
      status: "approved",
      selfReviewExceptionUsed: true,
    });
  });
});
