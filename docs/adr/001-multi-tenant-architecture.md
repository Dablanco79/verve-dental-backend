# ADR-001: Multi-Tenant Architecture

**Status:** Accepted  
**Date:** June 2026  
**Module:** 02 — Security & Multi-Tenant

## Context

Verve Dental serves 100+ clinics. Tenant data (inventory, rostering, payroll) must never leak across clinic boundaries.

## Decision

Use **defence in depth**:

1. **Application layer (Module 02):** JWT claims include `clinicId`. Middleware enforces tenant access on every tenant-scoped route. RBAC restricts actions by role.
2. **Database layer (Module 13):** PostgreSQL Row-Level Security (RLS) policies enforce `clinic_id` filtering even if application code regresses.

`owner_admin` retains cross-clinic visibility for platform administration. All other roles are restricted to their assigned clinic.

## Consequences

- Auth tokens carry tenant context — no implicit global access for staff roles.
- In-memory user repository is temporary until Module 13 migrations land.
- MFA is required for privileged roles when enabled on the account (dev code: `000000`).
