# Verve Operational Suite — Pilot Standard Operating Procedure (SOP)

**Document Version:** 1.0  
**Effective Date:** June 2026  
**Owner:** Daniel Blanco  
**Review Cycle:** Weekly during pilot; monthly thereafter  
**Classification:** Internal — Pilot Operations

---

## 1. Purpose

This SOP defines the operating model for the internal pilot of the Verve Operational Suite. It establishes expectations for participating clinics, defines the scope of supported functions, and provides the governance framework required to run the pilot in a controlled, measurable manner.

The pilot is intended to:

- Validate system stability and reliability under real operating conditions
- Identify usability gaps before broader rollout
- Build staff familiarity and confidence
- Produce evidence-based data to support a go/no-go decision for full deployment

---

## 2. Pilot Scope

### 2.1 Pilot Phase Structure

| Phase | Description | Duration |
|-------|-------------|----------|
| Phase 1 — Single Clinic | Pilot with one clinic; close monitoring and rapid iteration | 2 weeks |
| Phase 1 Review | Stability review; go/no-go to expand | 2–3 business days |
| Phase 2 — Expanded | Expand to up to 4 clinics | 4 weeks |
| Pilot Close | Metrics review; exit evaluation; deployment decision | 1 week |

### 2.2 Pilot Environment

The pilot operates on the **production Verve environment**. There is no separate staging environment for pilot users. All data entered during the pilot is live operational data.

> **Implication:** Errors made during the pilot (e.g. incorrect stock adjustments, timesheet submissions) are real records that must be corrected through normal operational processes.

### 2.3 Geographic Scope

Pilot is limited to clinics within the JD Group network. External parties are excluded.

---

## 3. Pilot Objectives

1. **Stability** — Confirm the platform sustains normal clinic operations without critical failures
2. **Adoption** — Achieve active usage by ≥ 80% of enrolled pilot users within 2 weeks
3. **Accuracy** — Inventory, rosters, and timesheets align with existing manual records
4. **Support Load** — Support ticket volume remains manageable (< 5 high-severity tickets/week)
5. **Satisfaction** — Net pilot satisfaction score ≥ 3.5 / 5 at the end of each phase
6. **Recovery** — Any critical incident resolved within defined SLA (see Section 8)
7. **Data Integrity** — No data loss or corruption events during the pilot

---

## 4. Participating Clinics

### Phase 1 — Single Clinic

| Field | Detail |
|-------|--------|
| Clinic | TBD by Daniel Blanco prior to pilot launch |
| Practice Manager | TBD |
| Clinical Lead | TBD |
| Pilot Administrator | Daniel Blanco |
| Start Date | Confirmed at go/no-go sign-off |

> **MANUAL OPERATOR ACTION REQUIRED:** Clinic selection and user provisioning must be completed before pilot launch. See `user-onboarding.md`.

### Phase 2 — Expanded Clinics

Up to 4 additional clinics, selected based on Phase 1 outcomes. Expansion criteria are defined in Section 9 (Exit Criteria).

---

## 5. Supported Functions

The following modules are in scope for the pilot:

| Module | Supported Functions |
|--------|---------------------|
| **Authentication** | Login, MFA enrollment, password reset |
| **Inventory Management** | View stock levels, record adjustments, view history |
| **Materials Forecast** | View forecast, review recommendations |
| **Procurement** | Create purchase orders, approve purchase orders, view PO history |
| **Roster Management** | View rosters, manager roster editing |
| **Timesheet Management** | Submit timesheets (staff), approve timesheets (managers) |
| **Leave Management** | Submit leave requests (staff), approve leave (managers) |
| **Analytics** | View operational dashboards |
| **User Management** | Admin user creation, role assignment (admin only) |

---

## 6. Excluded Functions

The following are **not available** during the pilot and must not be communicated to staff as available:

| Excluded Area | Notes |
|---------------|-------|
| Patient records / clinical notes | Not within platform scope |
| Billing / invoicing | Not within platform scope |
| Payroll processing | Timesheets captured only; payroll remains in existing system |
| External integrations (HICAPS, Xero, etc.) | Not yet implemented |
| Public-facing booking / scheduling | Not within platform scope |
| Mobile app | Web only during pilot |
| Automated notifications (SMS/email) | Not yet implemented |
| Multi-factor authentication via hardware key | Authenticator app only |

---

## 7. Daily Operating Expectations

### 7.1 Staff Expectations

- Staff should use Verve as their primary record for the functions listed in Section 5
- Parallel paper or manual records may be maintained during Phase 1 for reconciliation purposes
- Issues must be reported via the defined support process (see `support-process.md`)
- Staff are not expected to enter data twice; if unsure, ask the Practice Manager

### 7.2 Practice Manager Expectations

- Review and approve timesheets and leave requests within 24 hours of submission
- Monitor inventory adjustments daily and reconcile against physical stock weekly
- Review roster accuracy weekly
- Submit weekly feedback summary using the feedback template (see `pilot-feedback.md`)
- Attend weekly pilot review calls with Daniel Blanco

### 7.3 Pilot Administrator Expectations (Daniel Blanco)

- Monitor system health daily during Phase 1; every 2 days during Phase 2
- Review support tickets daily
- Coordinate incident response for any Critical or High severity incident
- Host weekly pilot review calls
- Maintain the pilot metrics dashboard (see `pilot-success-metrics.md`)

---

## 8. Escalation Process

### 8.1 Severity Definitions

| Severity | Definition | Response Target |
|----------|------------|-----------------|
| Critical | Platform unavailable; data loss risk; security breach | Immediate — < 30 minutes |
| High | Core function unavailable; multiple users affected | < 2 hours |
| Medium | Non-critical function impaired; workaround available | < 8 hours (business hours) |
| Low | Minor UX issue; cosmetic defect | Next business day |

### 8.2 Escalation Path

```
Staff Member
    ↓  Reports via support channel (see support-process.md)
Practice Manager
    ↓  Assesses severity; escalates if Critical or High
Daniel Blanco (Pilot Administrator)
    ↓  Coordinates response; engages technical resources if required
Technical Team / Infrastructure Owner
    ↓  Resolves incident
Daniel Blanco
    ↓  Confirms resolution; communicates to clinic
Practice Manager
    ↓  Confirms clinic operations restored
```

### 8.3 Out-of-Hours Critical Incidents

For Critical incidents outside of business hours (8:00 AM – 6:00 PM AEST):

- Contact Daniel Blanco directly via mobile
- If unresponsive within 30 minutes, document the issue and apply the relevant manual workaround
- Clinical operations must never be halted pending a platform issue

---

## 9. Pilot Success Criteria

The pilot is considered successful if all of the following are met at phase close:

| Criterion | Target |
|-----------|--------|
| System uptime | ≥ 99% over pilot period |
| Login success rate | ≥ 98% of attempts |
| MFA enrollment | 100% of enrolled users |
| Active usage rate | ≥ 80% of enrolled users active within 2 weeks |
| Critical incidents | 0 unresolved at phase close |
| High incidents | ≤ 2 per phase; all resolved within SLA |
| User satisfaction score | ≥ 3.5 / 5 |
| Support ticket backlog | 0 unresolved Critical or High at phase close |
| Data integrity | No data loss events |

Full metric definitions and measurement methods are in `pilot-success-metrics.md`.

---

## 10. Pilot Exit Criteria

### 10.1 Phase 1 → Phase 2 Expansion

Expansion to additional clinics is approved when:

- [ ] Phase 1 has run for a minimum of 10 business days
- [ ] All success criteria in Section 9 are met or on track
- [ ] No unresolved Critical or High incidents
- [ ] Practice Manager and clinical staff report satisfactory experience
- [ ] User onboarding process validated (all Phase 1 users successfully enrolled)
- [ ] Daniel Blanco signs off on expansion

### 10.2 Full Deployment Decision

At the close of Phase 2, a formal go/no-go review is conducted using the checklist in `go-no-go-checklist.md`.

### 10.3 Pilot Abandonment Criteria

The pilot may be paused or abandoned if:

- A Critical incident cannot be resolved within 24 hours
- Data integrity is compromised
- Staff safety or patient care is at risk due to platform behaviour
- Three or more High incidents occur within a single 5-business-day period without resolution

---

## 11. Amendments

Changes to this SOP during the pilot must be approved by Daniel Blanco and communicated to all Practice Managers before taking effect. Version history is maintained in the document header.

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*
