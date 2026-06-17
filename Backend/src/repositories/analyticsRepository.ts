import { randomUUID } from "node:crypto";

import type {
  AuditEvent,
  AuditEventsPage,
  CreateAuditEventInput,
  ListAuditEventsOptions,
} from "../types/analytics.js";

// ─────────────────────────────────────────────────────────────────────────────
// AnalyticsRepository interface
//
// Responsible only for the audit_events log. All analytics aggregations are
// computed by AnalyticsService using the domain repositories (billing,
// inventory, roster) so there is no separate analytics data store for KPIs.
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticsRepository {
  /** Persist a structured audit event for a clinic-scoped action. */
  recordEvent(input: CreateAuditEventInput): Promise<AuditEvent>;

  /** Paginated, filterable audit trail for a clinic. */
  listEvents(
    clinicId: string,
    options?: ListAuditEventsOptions,
  ): Promise<AuditEventsPage>;

  /** Retrieve a single audit event by ID within clinic scope. */
  getEvent(id: string, clinicId: string): Promise<AuditEvent | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers
// ─────────────────────────────────────────────────────────────────────────────

// Re-uses the canonical seed UUIDs established in userRepository.ts so that
// in-memory audit events reference real seeded entities.
const SEED_CLINIC_A_ID = "00000000-0000-0000-0000-000000000001";
const SEED_CLINIC_B_ID = "00000000-0000-0000-0000-000000000002";
const SEED_ADMIN_A_ID = "00000000-0000-0000-0000-000000000010";
const SEED_MANAGER_A_ID = "00000000-0000-0000-0000-000000000011";
const SEED_ADMIN_B_ID = "00000000-0000-0000-0000-000000000030";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d;
}

function buildSeedEvents(): AuditEvent[] {
  return [
    // ── Clinic A — user management ──────────────────────────────────────────
    {
      id: "a0000000-0000-0000-0000-000000000001",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "user",
      entityId: SEED_MANAGER_A_ID,
      action: "created",
      actorId: SEED_ADMIN_A_ID,
      actorEmail: "admin@clinic-a.au",
      metadata: {
        role: "group_practice_manager",
        email: "manager@clinic-a.au",
      },
      createdAt: daysAgo(14),
    },
    // ── Clinic A — roster events ────────────────────────────────────────────
    {
      id: "a0000000-0000-0000-0000-000000000002",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "roster_entry",
      entityId: "b1000000-0000-0000-0000-000000000001",
      action: "created",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: { shiftType: "standard", shiftDate: "2026-06-02" },
      createdAt: daysAgo(13),
    },
    {
      id: "a0000000-0000-0000-0000-000000000003",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "roster_entry",
      entityId: "b1000000-0000-0000-0000-000000000001",
      action: "updated",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: { field: "status", from: "scheduled", to: "confirmed" },
      createdAt: daysAgo(12),
    },
    // ── Clinic A — inventory events ─────────────────────────────────────────
    {
      id: "a0000000-0000-0000-0000-000000000004",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "inventory_adjustment",
      entityId: "c1000000-0000-0000-0000-000000000001",
      action: "scan_deduct",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: { sku: "VRV-GLV-001", quantity: 2, barcode: "9301234567890" },
      createdAt: daysAgo(10),
    },
    {
      id: "a0000000-0000-0000-0000-000000000005",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "inventory_adjustment",
      entityId: "c1000000-0000-0000-0000-000000000002",
      action: "manual_receive",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: { sku: "VRV-MSK-001", quantity: 50, note: "Restock delivery" },
      createdAt: daysAgo(2),
    },
    // ── Clinic A — billing events ───────────────────────────────────────────
    {
      id: "a0000000-0000-0000-0000-000000000006",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "invoice",
      entityId: "d1000000-0000-0000-0000-000000000001",
      action: "created",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: { patientName: "Jane Doe", status: "draft" },
      createdAt: daysAgo(8),
    },
    {
      id: "a0000000-0000-0000-0000-000000000007",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "invoice",
      entityId: "d1000000-0000-0000-0000-000000000001",
      action: "issued",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: { invoiceNumber: "INV-2026-000001", totalCents: 38500 },
      createdAt: daysAgo(7),
    },
    {
      id: "a0000000-0000-0000-0000-000000000008",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "payment",
      entityId: "e1000000-0000-0000-0000-000000000001",
      action: "recorded",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: {
        method: "eftpos",
        amountCents: 38500,
        reference: "TXN-001",
        invoiceId: "d1000000-0000-0000-0000-000000000001",
      },
      createdAt: daysAgo(6),
    },
    // ── Clinic A — leave event ──────────────────────────────────────────────
    {
      id: "a0000000-0000-0000-0000-000000000009",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "leave_request",
      entityId: "f1000000-0000-0000-0000-000000000001",
      action: "submitted",
      actorId: SEED_MANAGER_A_ID,
      actorEmail: "manager@clinic-a.au",
      metadata: {
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-05",
        days: 5,
      },
      createdAt: daysAgo(5),
    },
    // ── Clinic A — clinic settings ──────────────────────────────────────────
    {
      id: "a0000000-0000-0000-0000-000000000010",
      clinicId: SEED_CLINIC_A_ID,
      entityType: "clinic",
      entityId: SEED_CLINIC_A_ID,
      action: "settings_updated",
      actorId: SEED_ADMIN_A_ID,
      actorEmail: "admin@clinic-a.au",
      metadata: {
        field: "timezone",
        from: "Australia/Brisbane",
        to: "Australia/Sydney",
      },
      createdAt: daysAgo(3),
    },
    // ── Clinic B — events ───────────────────────────────────────────────────
    {
      id: "b0000000-0000-0000-0000-000000000001",
      clinicId: SEED_CLINIC_B_ID,
      entityType: "roster_entry",
      entityId: "b2000000-0000-0000-0000-000000000001",
      action: "created",
      actorId: SEED_ADMIN_B_ID,
      actorEmail: "admin@clinic-b.au",
      metadata: { shiftType: "overtime", shiftDate: "2026-06-10" },
      createdAt: daysAgo(5),
    },
    {
      id: "b0000000-0000-0000-0000-000000000002",
      clinicId: SEED_CLINIC_B_ID,
      entityType: "user",
      entityId: "00000000-0000-0000-0000-000000000031",
      action: "password_reset",
      actorId: SEED_ADMIN_B_ID,
      actorEmail: "admin@clinic-b.au",
      metadata: { targetEmail: "staff@clinic-b.au" },
      createdAt: daysAgo(1),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation
//
// ⚠️  NON-PRODUCTION / DEVELOPMENT SANDBOX ONLY ⚠️
// This implementation holds all audit events in process memory with no
// persistence. It is intended exclusively for local development, unit tests,
// and CI environments where a real Postgres connection is unavailable.
// Never wire this into a production deployment.
// ─────────────────────────────────────────────────────────────────────────────

// Per-tenant upper bound for the in-memory ring buffer — prevents a single
// noisy clinic from evicting another tenant's history and caps overall heap
// growth during long-running dev sessions or test suites.
const IN_MEMORY_MAX_EVENTS = 2_000;

/** Return (or lazily initialise) the event array for a given clinic. */
function getTenantBucket(
  map: Map<string, AuditEvent[]>,
  clinicId: string,
): AuditEvent[] {
  let bucket = map.get(clinicId);
  if (!bucket) {
    bucket = [];
    map.set(clinicId, bucket);
  }
  return bucket;
}

export function createInMemoryAnalyticsRepository(): AnalyticsRepository {
  // Tenant-partitioned store: each clinicId owns its own ring buffer so that
  // a high-volume tenant cannot push out another clinic's audit history.
  const tenantEvents = new Map<string, AuditEvent[]>();

  // Pre-populate with seed data, grouped by clinicId.
  for (const seedEvent of buildSeedEvents()) {
    getTenantBucket(tenantEvents, seedEvent.clinicId).push(seedEvent);
  }

  return {
    recordEvent(input: CreateAuditEventInput): Promise<AuditEvent> {
      const event: AuditEvent = {
        ...input,
        id: randomUUID(),
        createdAt: new Date(),
      };

      const bucket = getTenantBucket(tenantEvents, input.clinicId);
      bucket.push(event);

      // Evict oldest events from *this tenant's* bucket only, so a noisy
      // clinic cannot displace audit history belonging to another clinic.
      if (bucket.length > IN_MEMORY_MAX_EVENTS) {
        bucket.splice(0, bucket.length - IN_MEMORY_MAX_EVENTS);
      }

      return Promise.resolve({ ...event });
    },

    listEvents(
      clinicId: string,
      options: ListAuditEventsOptions = {},
    ): Promise<AuditEventsPage> {
      const {
        entityType,
        actorId,
        entityId,
        from,
        to,
        limit = 50,
        offset = 0,
      } = options;

      let filtered = [...(tenantEvents.get(clinicId) ?? [])];

      if (entityType !== undefined) {
        filtered = filtered.filter((e) => e.entityType === entityType);
      }
      if (actorId !== undefined) {
        filtered = filtered.filter((e) => e.actorId === actorId);
      }
      if (entityId !== undefined) {
        filtered = filtered.filter((e) => e.entityId === entityId);
      }
      if (from !== undefined) {
        filtered = filtered.filter((e) => e.createdAt >= from);
      }
      if (to !== undefined) {
        filtered = filtered.filter((e) => e.createdAt <= to);
      }

      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);

      return Promise.resolve({
        events: page.map((e) => ({ ...e })),
        total,
        limit,
        offset,
      });
    },

    getEvent(id: string, clinicId: string): Promise<AuditEvent | null> {
      const bucket = tenantEvents.get(clinicId);
      if (!bucket) return Promise.resolve(null);
      const event = bucket.find((e) => e.id === id);
      return Promise.resolve(event ? { ...event } : null);
    },
  };
}
