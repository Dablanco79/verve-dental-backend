# RLS Audit Report — Verve Dental Operational Suite

**Auditor:** Principal Security Architect  
**Date:** June 2026  
**Scope:** All PostgreSQL tables created by migrations 003–014  
**Standard:** Multi-tenant row-level security, OWASP A01:2021 Broken Access Control

---

## Executive Summary

| Category | Count | RLS Required |
|----------|-------|--------------|
| Global / shared tables | 4 | No |
| Clinic-owned tables (direct `clinic_id`) | 11 | **Yes** |
| Clinic-owned tables (indirect FK) | 2 | **Yes** |
| Internal / sequence tables | 2 | No (or scoped) |
| **Total tables** | **19** | **13 require RLS** |

**Current protection model:** Application-layer filtering only (`WHERE clinic_id = $1` in every query). No database-enforced tenant boundary exists. A single application bug could expose cross-tenant data.

**Recommended protection model:** Application-layer filtering + PostgreSQL RLS as defence-in-depth. RLS rejects cross-tenant rows at the database engine level even if the application layer is compromised or bypassed.

---

## Table Classification

### GLOBAL / SHARED — No RLS Required

These tables contain data shared across all tenants. No per-clinic row filter applies.

| Table | Migration | Reason | Current Protection |
|-------|-----------|--------|--------------------|
| `schema_migrations` | 003 | Internal migration tracking. No tenant data. | Table is not queryable from application. |
| `master_catalog_items` | 005 | Head-office-approved global product catalog. All clinics read the same catalog. | Read-only from application. Writes are admin-only. |
| `barcode_mappings` | 005 | Global barcode ↔ SKU mappings. Referenced from `master_catalog_items`. | Read-only from application. |
| `clinics` | 012 | The canonical tenant registry. This IS the RLS anchor — it does not filter by itself. | Application-layer RBAC + enforceTenantParam middleware. |

### CLINIC-OWNED — Direct `clinic_id` Column — RLS Required

These tables carry a non-nullable `clinic_id` UUID that references `clinics.id` and is the primary tenant discriminator.

| Table | Migration | Tenant Column | Current Protection | Recommended RLS Policy |
|-------|-----------|---------------|-------------------|------------------------|
| `users` | 003 | `home_clinic_id` | JWT + enforceTenantParam + RBAC | `home_clinic_id = app_current_clinic_id()` OR context NULL (permits auth email-lookup) |
| `clinic_inventory_items` | 005 | `clinic_id` | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `inventory_adjustments` | 005 | `clinic_id` | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `draft_purchase_orders` | 005 | `clinic_id` | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `roster_entries` | 006 | `rostered_clinic_id` | `WHERE rostered_clinic_id = $1` in all queries | `rostered_clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `timesheet_entries` | 008 | `clinic_id` (home), `rostered_clinic_id` | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `leave_requests` | 008 | `clinic_id` | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `invoices` | 013 | `clinic_id` | `WHERE clinic_id = $1` in all queries + `assertTenantAccess()` service guard | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `invoice_line_items` | 013 | `clinic_id` (redundant) | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `payment_records` | 013 | `clinic_id` (redundant) | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |
| `audit_events` | 014 | `clinic_id` | `WHERE clinic_id = $1` in all queries | `clinic_id = app_current_clinic_id()` OR owner-admin mode |

### CLINIC-OWNED — Indirect FK — RLS Required

These tables have no direct `clinic_id` column but inherit their tenant scope from a parent row.

| Table | Migration | Tenant Path | Current Protection | Recommended RLS Policy |
|-------|-----------|-------------|-------------------|------------------------|
| `draft_po_lines` | 005 | `draft_purchase_order_id` → `draft_purchase_orders.clinic_id` | `JOIN` in all queries, always fetched through parent PO | `EXISTS (SELECT 1 FROM draft_purchase_orders p WHERE p.id = draft_purchase_order_id AND p.clinic_id = app_current_clinic_id())` |
| `roster_entry_audit` | 006 | `roster_entry_id` → `roster_entries.rostered_clinic_id` | `JOIN` in all queries, always fetched through parent entry | `EXISTS (SELECT 1 FROM roster_entries r WHERE r.id = roster_entry_id AND r.rostered_clinic_id = app_current_clinic_id())` |

### INTERNAL / SEQUENCE — Scoped RLS Required

| Table | Migration | Tenant Column | Current Protection | Recommended RLS Policy |
|-------|-----------|---------------|-------------------|------------------------|
| `invoice_number_sequences` | 013 | `clinic_id` (PK) | Service-layer isolation via `BillingService` | `clinic_id = app_current_clinic_id()` OR owner-admin mode |

---

## Current Protections Assessment

### Defence Layers (existing)

1. **JWT authentication** — All API routes require a valid short-lived access token.
2. **RBAC middleware (`requireRoles`)** — Route-level role enforcement.
3. **`enforceTenantParam` middleware** — URL `:clinicId` checked against `JWT.homeClinicId`. Blocks cross-clinic parameter manipulation for non-owner-admin users.
4. **Application-layer filtering** — Every repository query includes `WHERE clinic_id = $1` with the authenticated user's clinic ID.
5. **Service-layer guards** — `assertTenantAccess()` in `BillingService`; `assertClinicReadAccess()` in `RosterService`. Defence-in-depth beyond middleware.

### Identified Gaps

| Gap | Severity | Mitigation |
|-----|----------|-----------|
| No database-enforced tenant boundary | **HIGH** | This RLS implementation addresses it |
| Direct DB connection bypasses all app-layer controls | **CRITICAL** | RLS at DB level eliminates this vector |
| `draft_po_lines` and `roster_entry_audit` have no direct `clinic_id` | **MEDIUM** | Subquery EXISTS policies provide equivalent protection |
| `users` table auth queries require NULL-context bypass | **LOW** | Policy includes `OR app_current_clinic_id() IS NULL` |
| Connection pool reuse may expose stale session vars | **MEDIUM** | `withTenantContext` uses transaction-local `SET LOCAL`; documented in guide |

---

## Role Access Matrix

| Role | Scope | Application Guard | RLS Setting |
|------|-------|-------------------|-------------|
| `owner_admin` | All clinics | `enforceTenantParam` bypassed; service guards allow | `app.owner_admin_mode = 'true'` |
| `group_practice_manager` | Own `home_clinic_id` only | `enforceTenantParam` enforces | `app.current_clinic_id = JWT.homeClinicId` |
| `clinical_staff` | Own `home_clinic_id` only (read-only) | `enforceTenantParam` enforces | `app.current_clinic_id = JWT.homeClinicId` |

---

## Recommended Migration Strategy

1. **Migration 015** — Enable RLS on all 13 tenant tables; create policies; create helper functions. Applied via `runBootstrapMigrations` (idempotent, advisory-locked).
2. **No data backfill required** — All existing rows already have `clinic_id` populated.
3. **Application integration** — `withTenantContext()` wrapper for explicit tenant scoping; `AsyncLocalStorage` pool wrapper for transparent injection.
4. **Rollback** — `015_rls_policies.down.sql` disables all policies and RLS in reverse order.
