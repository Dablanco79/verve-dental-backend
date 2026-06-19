/**
 * Audit Trail Coverage Integration Tests — Sprint J
 *
 * Proves that audit_events rows are written for the five critical
 * business workflows mandated by the sprint:
 *
 *   1. Invoice creation     — entityType: invoice,              action: created
 *   2. Inventory adjustment — entityType: inventory_adjustment, action: manual_adjust
 *   3. User creation        — entityType: user,                 action: user.created
 *   4. Roster entry created — entityType: roster_entry,         action: created
 *   5. Leave approval       — entityType: leave_request,        action: approved
 *
 * All tests use the in-memory repositories (no database required).
 * The audit_events in-memory store uses synchronous Promises so events
 * are durably written before the next HTTP request is issued.
 *
 * Test pattern:
 *   1. Perform the business mutation via the HTTP API.
 *   2. Query GET /analytics/audit-events?entityType=<type> immediately after.
 *   3. Assert at least one event with the expected action exists.
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { SEED_CLINIC_INVENTORY_IDS } from "../src/repositories/seed/inventorySeed.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

// ─── Response shape helpers ───────────────────────────────────────────────────

type ApiData<T> = { data: T };

type AuditEventDto = {
  id: string;
  clinicId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  actorEmail: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditEventsPage = {
  events: AuditEventDto[];
  total: number;
  limit: number;
  offset: number;
};

type InvoiceDto = { id: string; status: string; patientName: string };
type RosterEntryDto = { id: string; status: string };
type LeaveRequestDto = { id: string; status: string };

// ─── URL builders ─────────────────────────────────────────────────────────────

const BILLING = (clinicId: string) =>
  `/api/v1/clinics/${clinicId}/billing`;

const AUDIT = (clinicId: string, entityType?: string) => {
  const base = `/api/v1/clinics/${clinicId}/analytics/audit-events`;
  return entityType ? `${base}?entityType=${entityType}` : base;
};

const ROSTER = (clinicId: string) =>
  `/api/v1/clinics/${clinicId}/roster`;

const LEAVE = (clinicId: string) =>
  `/api/v1/clinics/${clinicId}/leave`;

const USERS = (clinicId: string) =>
  `/api/v1/clinics/${clinicId}/users`;

const INVENTORY_ADJUST = (clinicId: string) =>
  `/api/v1/clinics/${clinicId}/inventory/adjust`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Invoice creation
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit trail — invoice creation", () => {
  it("writes an audit event with action 'created' when a draft invoice is created", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const createRes = await request(app)
      .post(`${BILLING(SEED_CLINIC_A_ID)}/invoices`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        patientName: "Jane Doe",
        taxRateBasisPoints: 1000,
        notes: null,
      });

    expect(createRes.status).toBe(201);
    const invoice = (createRes.body as ApiData<InvoiceDto>).data;

    const auditRes = await request(app)
      .get(AUDIT(SEED_CLINIC_A_ID, "invoice"))
      .set("Authorization", `Bearer ${managerToken}`);

    expect(auditRes.status).toBe(200);
    const page = (auditRes.body as ApiData<AuditEventsPage>).data;

    const match = page.events.find(
      (e) =>
        e.entityType === "invoice" &&
        e.action === "created" &&
        e.entityId === invoice.id,
    );

    expect(match).toBeDefined();
    expect(match?.actorId).toBe(SEED_USER_IDS.clinicAManager);
    expect(match?.metadata).toMatchObject({ patientName: "Jane Doe" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Inventory adjustment
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit trail — inventory adjustment", () => {
  it("writes an audit event with action 'manual_adjust' when stock is adjusted", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const adjustRes = await request(app)
      .post(INVENTORY_ADJUST(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        itemId: SEED_CLINIC_INVENTORY_IDS.clinicAGloves,
        quantityDelta: 5,
        reason: "Quarterly stock correction",
      });

    expect(adjustRes.status).toBe(200);

    const auditRes = await request(app)
      .get(AUDIT(SEED_CLINIC_A_ID, "inventory_adjustment"))
      .set("Authorization", `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    const page = (auditRes.body as ApiData<AuditEventsPage>).data;

    const match = page.events.find(
      (e) =>
        e.entityType === "inventory_adjustment" &&
        e.action === "manual_adjust",
    );

    expect(match).toBeDefined();
    expect(match?.metadata).toMatchObject({ quantityDelta: 5 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. User creation
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit trail — user creation", () => {
  it("writes an audit event with action 'user.created' and resourceId set to the new user's id", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const createRes = await request(app)
      .post(USERS(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "new.staff@clinic-a.au",
        password: "Str0ngP@ssword!",
        role: "clinical_staff",
        clinicName: "Verve Dental Clinic A",
      });

    expect(createRes.status).toBe(201);
    const newUser = (createRes.body as ApiData<{ id: string }>).data;

    const auditRes = await request(app)
      .get(AUDIT(SEED_CLINIC_A_ID, "user"))
      .set("Authorization", `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    const page = (auditRes.body as ApiData<AuditEventsPage>).data;

    const match = page.events.find(
      (e) =>
        e.entityType === "user" &&
        e.action === "user.created" &&
        e.entityId === newUser.id,
    );

    expect(match).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Roster entry creation
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit trail — roster entry creation", () => {
  it("writes an audit event with action 'created' when a roster entry is created", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const shiftStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const shiftEnd = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000,
    ).toISOString();

    const createRes = await request(app)
      .post(ROSTER(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAStaff,
        rosteredClinicName: "Verve Dental Clinic A",
        shiftStartAt: shiftStart,
        shiftEndAt: shiftEnd,
        shiftType: "standard",
        notes: null,
      });

    expect(createRes.status).toBe(201);
    const entry = (createRes.body as ApiData<RosterEntryDto>).data;

    const auditRes = await request(app)
      .get(AUDIT(SEED_CLINIC_A_ID, "roster_entry"))
      .set("Authorization", `Bearer ${managerToken}`);

    expect(auditRes.status).toBe(200);
    const page = (auditRes.body as ApiData<AuditEventsPage>).data;

    const match = page.events.find(
      (e) =>
        e.entityType === "roster_entry" &&
        e.action === "created" &&
        e.entityId === entry.id,
    );

    expect(match).toBeDefined();
    expect(match?.actorId).toBe(SEED_USER_IDS.clinicAManager);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Leave request approval
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit trail — leave request approval", () => {
  it("writes an audit event with action 'approved' when a leave request is approved", async () => {
    const app = await createTestApp();
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dayAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const createRes = await request(app)
      .post(LEAVE(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        leaveType: "annual",
        startDate: fmt(tomorrow),
        endDate: fmt(dayAfter),
        totalDays: 2,
        reason: "Family holiday",
      });

    expect(createRes.status).toBe(201);
    const leaveRequest = (createRes.body as ApiData<LeaveRequestDto>).data;
    expect(leaveRequest.status).toBe("pending");

    const approveRes = await request(app)
      .post(`${LEAVE(SEED_CLINIC_A_ID)}/${leaveRequest.id}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ reviewNotes: "Approved — no conflicts." });

    expect(approveRes.status).toBe(200);

    const auditRes = await request(app)
      .get(AUDIT(SEED_CLINIC_A_ID, "leave_request"))
      .set("Authorization", `Bearer ${managerToken}`);

    expect(auditRes.status).toBe(200);
    const page = (auditRes.body as ApiData<AuditEventsPage>).data;

    const match = page.events.find(
      (e) =>
        e.entityType === "leave_request" &&
        e.action === "approved" &&
        e.entityId === leaveRequest.id,
    );

    expect(match).toBeDefined();
    expect(match?.actorId).toBe(SEED_USER_IDS.clinicAManager);
    expect(match?.metadata).toMatchObject({
      staffUserId: SEED_USER_IDS.clinicAStaff,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: no secrets in audit metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit trail — security: no secrets in metadata", () => {
  it("user.created event does not contain password or hash in metadata", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    await request(app)
      .post(USERS(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "secure.check@clinic-a.au",
        password: "Str0ngP@ssword!",
        role: "clinical_staff",
        clinicName: "Verve Dental Clinic A",
      });

    const auditRes = await request(app)
      .get(AUDIT(SEED_CLINIC_A_ID, "user"))
      .set("Authorization", `Bearer ${adminToken}`);

    const page = (auditRes.body as ApiData<AuditEventsPage>).data;

    for (const event of page.events) {
      const metaStr = JSON.stringify(event.metadata).toLowerCase();
      expect(metaStr).not.toContain("password");
      expect(metaStr).not.toContain("hash");
      expect(metaStr).not.toContain("secret");
      expect(metaStr).not.toContain("token");
    }
  });
});
