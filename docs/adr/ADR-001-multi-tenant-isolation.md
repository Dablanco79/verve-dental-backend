# ADR-001: Multi-Tenant Isolation

**Status:** Accepted  
**Date:** June 2026  
**Module:** 02 — Security & Multi-Tenant

## Context

Verve serves 100+ dental clinics. Clinic data must never leak across tenants, even if application-layer filtering fails.

## Decision

Use **dual-layer isolation**:

1. **Application layer** — JWT carries `clinicId`; middleware (`enforceTenantParam`, `resolveTenantClinicId`) blocks cross-tenant API access.
2. **Database layer** — PostgreSQL RLS on all tenant-owned tables using `app.current_clinic_id` session variable (Module 13).

## Consequences

- Every authenticated request resolves a tenant scope before data access.
- Owner/admin roles may access any clinic via explicit route parameters.
- Clinical staff are restricted to their assigned `clinicId`.
- RLS migration foundation lives in `Backend/migrations/001_tenant_rls_foundation.sql`.
