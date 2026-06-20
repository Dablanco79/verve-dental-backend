# Verve Operational Suite — Go / No-Go Checklist

**Version:** 1.0  
**Owner:** Daniel Blanco  
**Audience:** Daniel Blanco (Decision Maker), Practice Managers (Input)  
**Classification:** Internal — Pilot Governance  
**Last Updated:** June 2026

---

## Purpose

This checklist is the formal decision gate for:

1. **Pilot Launch** — confirming readiness before the first clinic goes live
2. **Phase 1 → Phase 2 Expansion** — confirming readiness to expand to additional clinics
3. **Full Deployment** — confirming readiness to exit the pilot and proceed to production rollout

Each section must be completed and signed off. The final recommendation is made by Daniel Blanco based on the outcomes of all sections.

---

## How to Use This Checklist

- Complete this checklist at each decision gate
- Each item must be marked: ✅ **PASS** / ⚠️ **CONDITIONAL** / ❌ **FAIL**
- Items marked CONDITIONAL must have a documented condition and remediation plan
- Items marked FAIL must be escalated and resolved before a GO decision is made
- Final recommendation options: **GO / GO WITH CONDITIONS / NO GO**

---

## Section 1 — Security

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1.1 | Row-Level Security (RLS) is implemented and verified — users can only access their own clinic's data | | |
| 1.2 | MFA is enforced for all admin and Practice Manager accounts | | |
| 1.3 | Authentication is functional and tested — login, session management, logout | | |
| 1.4 | Password policy enforced (minimum length, complexity) | | |
| 1.5 | No known open security vulnerabilities (critical or high) | | |
| 1.6 | Audit trail is active — all record modifications are logged with user, timestamp, and change | | |
| 1.7 | Sensitive data (passwords, tokens) is not stored in plain text | | |
| 1.8 | HTTPS is enforced on all platform endpoints | | |
| 1.9 | Admin accounts use dedicated credentials — no shared logins | | |
| 1.10 | Security hardening measures from previous sprints confirmed active | | |

**Section 1 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 2 — Operations

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 2.1 | All pilot users are onboarded per `user-onboarding.md` | | |
| 2.2 | User roles and clinic assignments are correct for all users | | |
| 2.3 | Support process is in place and communicated to all users | | |
| 2.4 | Incident management process is in place — severity levels, escalation path, templates ready | | |
| 2.5 | Pilot Administrator (Daniel Blanco) is available and contactable during pilot hours | | |
| 2.6 | Weekly review call schedule is confirmed with Practice Managers | | |
| 2.7 | Feedback collection templates are distributed to Practice Managers | | |
| 2.8 | Metrics tracking spreadsheet is set up and ready | | |
| 2.9 | All modules in scope (Section 5 of SOP) are functional and tested | | |
| 2.10 | Manual workarounds are documented for key functions (in case of platform failure) | | |

**Section 2 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 3 — Backups

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 3.1 | Automated database backups are configured and running | | |
| 3.2 | Backup frequency confirmed (daily minimum) | | |
| 3.3 | Backup retention policy confirmed (≥ 30 days) | | |
| 3.4 | Backup storage is in a separate location from the primary database | | |
| 3.5 | Backup success notifications are configured | | |
| 3.6 | Backup failure alerts are configured | | |

> **MANUAL OPERATOR ACTION REQUIRED:** Verify backup configuration via the hosting provider (Render / Supabase) before confirming items 3.1–3.6.

**Section 3 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 4 — Recovery

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 4.1 | A restore drill has been completed and documented (`docs/runbooks/restore-drill.md`) | | |
| 4.2 | Recovery Time Objective (RTO) is defined and achievable | | |
| 4.3 | Recovery Point Objective (RPO) is defined and acceptable | | |
| 4.4 | Database restoration runbook is available and tested | | |
| 4.5 | Redis failure runbook is available | | |
| 4.6 | Deployment failure runbook is available | | |
| 4.7 | Technical team knows how to execute each runbook | | |

**Section 4 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 5 — Training

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 5.1 | All Practice Managers have read `manager-quick-start.md` and confirmed understanding | | |
| 5.2 | All clinical staff have read `staff-quick-start.md` and confirmed understanding | | |
| 5.3 | All users completed orientation walkthrough with Practice Manager or Pilot Administrator | | |
| 5.4 | Users understand how to report issues (support process) | | |
| 5.5 | Users understand what is NOT in scope for the pilot (patient records, payroll, etc.) | | |
| 5.6 | MFA setup guidance has been communicated to all users who require it | | |

**Section 5 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 6 — Support

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 6.1 | Support email or channel is set up and accessible | | |
| 6.2 | Support contact details have been distributed to all Practice Managers | | |
| 6.3 | Out-of-hours Critical incident contact (Daniel Blanco mobile) confirmed | | |
| 6.4 | Response time SLAs defined and communicated (`support-process.md`) | | |
| 6.5 | Incident log template is ready for use | | |
| 6.6 | Pilot Administrator has capacity to handle support during the pilot period | | |

**Section 6 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 7 — Documentation

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 7.1 | `pilot-sop.md` — complete and reviewed | | |
| 7.2 | `manager-quick-start.md` — complete and distributed | | |
| 7.3 | `staff-quick-start.md` — complete and distributed | | |
| 7.4 | `incident-management.md` — complete and reviewed by Pilot Administrator | | |
| 7.5 | `support-process.md` — complete and distributed | | |
| 7.6 | `user-onboarding.md` — complete and used for all pilot onboarding | | |
| 7.7 | `user-offboarding.md` — complete and ready for use | | |
| 7.8 | `pilot-success-metrics.md` — complete and tracker set up | | |
| 7.9 | `pilot-feedback.md` — complete and templates distributed | | |
| 7.10 | Runbooks (`restore-drill.md`, `database-down.md`, `redis-down.md`) — complete and accessible | | |

**Section 7 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 8 — User Setup

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 8.1 | All pilot users created in the system | | |
| 8.2 | All users assigned correct roles | | |
| 8.3 | All users assigned to correct clinic only | | |
| 8.4 | All required MFA users have completed MFA enrollment | | |
| 8.5 | All users have successfully logged in at least once | | |
| 8.6 | All users have changed their temporary password | | |
| 8.7 | Onboarding register is complete and up to date | | |
| 8.8 | No users have access to clinics they should not access | | |

**Section 8 Result:** ☐ All Pass / ☐ Conditional (list items) / ☐ Fail

**Conditions to resolve:**
_______________________________________________

---

## Section 9 — Pilot Success Metrics (Phase Close Only)

*Complete this section only at Phase 1 close and Phase 2 close.*

| Metric | Target | Actual | Result |
|--------|--------|--------|--------|
| M1 Login Success Rate | ≥ 98% | | |
| M2 MFA Enrollment | 100% | | |
| M3 Inventory Adjustment Usage | ≥ 3/clinic/week avg | | |
| M4 Forecast Usage | ≥ 1/PM/week avg | | |
| M5 Roster Usage | ≥ 1 published/clinic/week | | |
| M6 Timesheet Submission | ≥ 80% of staff | | |
| M7 Leave Request Usage | 100% via Verve | | |
| M8 System Availability | ≥ 99% | | |
| M9 Support Ticket Volume | ≤ 10/week; ≤ 2 High/week | | |
| M10 Critical Incident Count | 0 | | |
| M11 User Satisfaction | ≥ 3.5 / 5.0 | | |

**Section 9 Result:** ☐ All at threshold / ☐ Conditional / ☐ Fail

---

## Final Recommendation

### Scoring Summary

| Section | Result |
|---------|--------|
| 1. Security | |
| 2. Operations | |
| 3. Backups | |
| 4. Recovery | |
| 5. Training | |
| 6. Support | |
| 7. Documentation | |
| 8. User Setup | |
| 9. Metrics (phase close) | |

---

### Decision

> Select one of the three options below and complete the sign-off.

---

#### ✅ GO

All sections pass with no outstanding conditions. The pilot may proceed to the next phase / full deployment.

**Conditions:** None  
**Decision Maker:** Daniel Blanco  
**Date:** _______________  
**Signature / Approval:** _______________

---

#### ⚠️ GO WITH CONDITIONS

One or more sections have conditional items. The pilot may proceed, but the following conditions must be resolved by the date specified.

| Condition | Owner | Due Date | Resolution |
|-----------|-------|----------|-----------|
| | | | |
| | | | |
| | | | |

**Decision Maker:** Daniel Blanco  
**Date:** _______________  
**Signature / Approval:** _______________  
**Condition Review Date:** _______________

---

#### ❌ NO GO

One or more critical sections have failed. The pilot must not proceed until the following items are resolved.

| Blocking Item | Owner | Target Resolution Date |
|--------------|-------|----------------------|
| | | |
| | | |

**Decision Maker:** Daniel Blanco  
**Date:** _______________  
**Signature / Approval:** _______________  
**Re-evaluation Date:** _______________

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*
