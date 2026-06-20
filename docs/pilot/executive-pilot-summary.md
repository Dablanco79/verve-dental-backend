# Verve Operational Suite — Executive Pilot Summary

**Version:** 1.0  
**Prepared By:** Pilot Readiness Reviewer  
**Prepared For:** Daniel Blanco, Owner — JD Group  
**Date:** June 2026  
**Classification:** Internal — Confidential

---

## Overview

This document provides a direct summary of the Verve Operational Suite's current readiness for internal pilot, prepared for your review and decision. It is designed to give you the full picture in one place — strengths, risks, outstanding conditions, and a clear recommendation.

---

## 1. Current Readiness Assessment

Verve has completed a substantial build programme across multiple sprints. The platform is now operationally capable of supporting the core functions required for an internal pilot within the JD Group clinic network.

The platform is **pilot-ready with conditions**. It has the technical foundations, security controls, and core module set required to begin a controlled, single-clinic pilot. A small number of operational tasks must be completed before launch (detailed in Section 4).

| Readiness Area | Assessment | Confidence |
|----------------|-----------|------------|
| Security & Access Control | Strong — RLS, MFA, audit trail complete | High |
| Core Modules (Inventory, Roster, Timesheets, Leave) | Functional and pilot-ready | High |
| Procurement / Forecast | Available and functional | Moderate |
| Analytics | Dashboard available; depth limited | Moderate |
| Backup & Recovery | Infrastructure in place; drill completed | Moderate |
| Operational Documentation | Complete as of Sprint P | High |
| User Onboarding Process | Defined; requires operator execution | High |
| Support & Incident Management | Defined; lightweight but fit for pilot scale | High |
| External Integrations (payroll, billing) | Not available | N/A — excluded from pilot |

---

## 2. Major Strengths

### Security Foundation is Production-Grade

The security work completed across Sprints G–K.1 is comprehensive for a platform at this stage. Row-Level Security is implemented at the database level — users cannot access other clinics' data even if they attempt to. MFA is enforced. The audit trail covers all record modifications. These are not checkbox features; they are structural controls that would stand up to scrutiny.

### Core Operational Workflows Are Complete

The four workflows that matter most for daily clinic operations — inventory management, roster management, timesheet submission and approval, and leave management — are implemented and functional. Practice Managers and clinical staff can perform their primary tasks without workarounds.

### Recovery Posture Is Defined

A restore drill has been completed. Runbooks exist for database failure, Redis failure, deployment failure, and backup restore. The team knows how to respond to the most likely failure scenarios.

### Complete Operational Package

The documentation and process package produced in Sprint P provides everything needed to onboard, operate, and govern the pilot. This is not usually available at this stage of a SaaS pilot and represents a meaningful reduction in operational risk.

### Procurement and Forecasting Provide Competitive Differentiation

The materials forecast and purchase order capability goes beyond basic operational tools. These features, even in their current form, provide Practice Managers with visibility they typically lack — and represent a significant reason to adopt the platform beyond simply replacing manual processes.

---

## 3. Known Risks

### Risk 1 — No Production Traffic History

**Risk:** The platform has not been tested under real operational load with real users making concurrent changes.  
**Likelihood:** Moderate  
**Impact:** Medium — performance issues or edge-case bugs may surface during Phase 1  
**Mitigation:** Phase 1 is limited to one clinic for this reason. Monitor performance closely. Phase 2 expansion is contingent on Phase 1 stability.

---

### Risk 2 — Manual Operator Actions Required at Launch

**Risk:** Several pre-launch steps (user creation, backup verification, support contact distribution) require manual execution by the Pilot Administrator and are not automated.  
**Likelihood:** High (they will be needed)  
**Impact:** Low if completed; High if missed  
**Mitigation:** The go/no-go checklist (`go-no-go-checklist.md`) covers all required actions. Do not launch without completing the checklist.

---

### Risk 3 — Staff Adoption Uncertainty

**Risk:** Clinical staff may resist changing from existing manual processes, particularly for timesheets and leave requests.  
**Likelihood:** Moderate  
**Impact:** Medium — low adoption undermines the pilot's value signal  
**Mitigation:** The onboarding and training process is lightweight and practical. Practice Manager sponsorship is critical — staff take their cue from their manager. Weekly satisfaction scores will surface adoption issues early.

---

### Risk 4 — Payroll and Leave Balance Expectations

**Risk:** Staff may expect timesheets submitted in Verve to flow directly into payroll, or leave requests to automatically update their leave balances. Neither is connected yet.  
**Likelihood:** High — this is a common misunderstanding  
**Impact:** Medium — trust damage if staff discover this after expecting integration  
**Mitigation:** This is explicitly communicated in both quick start guides and the SOP. Practice Managers must reinforce this during onboarding. The risk is managed through clear communication, not technical fix.

---

### Risk 5 — Single Administrator Dependency

**Risk:** Daniel Blanco is the sole Pilot Administrator. If unavailable for an extended period, there is no designated backup.  
**Likelihood:** Low  
**Impact:** High if a Critical incident occurs during unavailability  
**Mitigation:** Consider designating a backup Pilot Administrator (e.g. a trusted Practice Manager with elevated access) before Phase 2 expansion.

---

## 4. Outstanding Conditions

The following must be completed before the pilot launches. These are operational tasks, not technical development items.

| # | Condition | Owner | When Required |
|---|-----------|-------|---------------|
| OC-1 | Select Phase 1 pilot clinic and confirm Practice Manager participation | Daniel Blanco | Before launch |
| OC-2 | Create all pilot user accounts in the Verve Admin panel | Daniel Blanco | Before launch |
| OC-3 | Assign correct roles and clinic assignments to all users | Daniel Blanco | Before launch |
| OC-4 | Distribute Verve URL and temporary credentials to all users | Daniel Blanco | Before launch |
| OC-5 | Confirm backup configuration is active via hosting provider | Daniel Blanco / Infra | Before launch |
| OC-6 | Establish and distribute support contact details (email, mobile) to Practice Managers | Daniel Blanco | Before launch |
| OC-7 | Distribute quick start guides and collect acknowledgement | Practice Manager | Before first user login |
| OC-8 | Complete the go/no-go checklist (`go-no-go-checklist.md`) and obtain formal sign-off | Daniel Blanco | Before launch |
| OC-9 | Confirm weekly review call schedule with Practice Manager(s) | Daniel Blanco | Before launch |
| OC-10 | Set up the pilot metrics tracking spreadsheet | Daniel Blanco | Before launch |

> **None of these conditions require code changes or infrastructure modifications.** They are administrative tasks within the Pilot Administrator's control.

---

## 5. Pilot Recommendation

**Recommendation: GO WITH CONDITIONS**

Verve is ready to begin a controlled, single-clinic internal pilot. The platform has the security, functionality, and operational governance required to run responsibly. The outstanding conditions (Section 4) are all administrative in nature and can be completed within a few days.

The phased approach — starting with one clinic before expanding — is strongly recommended and should not be shortcut. Phase 1 is as much a readiness test of the operating model as it is a test of the technology.

---

## 6. Estimated Pilot Timeline

| Phase | Activity | Duration | Milestone |
|-------|----------|----------|-----------|
| Pre-launch | Complete outstanding conditions; go/no-go sign-off | 3–5 business days | Go/No-Go signed |
| Phase 1 | Single clinic live; close monitoring | 2 weeks | Phase 1 review |
| Phase 1 Review | Stability assessment; metrics review; expansion decision | 2–3 business days | Expand / hold |
| Phase 2 | Expand to up to 4 clinics | 4 weeks | Phase 2 review |
| Pilot Close | Full metrics review; exit evaluation; deployment decision | 1 week | Full deployment GO / NO GO |

**Total estimated pilot duration: 8–9 weeks from launch**

---

## 7. Recommended Pilot Structure

### Phase 1 — Single Clinic

Start with **one clinic** — ideally the clinic with the most engaged Practice Manager. This clinic will:

- Surface all onboarding edge cases before they affect multiple sites
- Test the support process at low volume
- Build the first internal reference story for the platform
- Produce the first real-world metrics data

**Success at Phase 1 is defined as:** all 11 metrics at or above threshold after 2 weeks, with no unresolved Critical or High incidents.

---

### Phase 1 Review — Stability Gate

Before expanding, conduct a structured review:

- Review all Phase 1 metrics against targets
- Review the incident log and support ticket volume
- Interview the Practice Manager and at least 2 clinical staff
- Confirm the onboarding process worked end-to-end

**If Phase 1 passes:** proceed to Phase 2  
**If Phase 1 is marginal:** extend Phase 1 by 1 week and re-evaluate  
**If Phase 1 fails a critical metric:** halt and remediate before proceeding

---

### Phase 2 — Expand to 4 Clinics

With Phase 1 stability confirmed, expand to up to 4 clinics simultaneously. At this scale:

- The support process will be more heavily exercised
- Onboarding should follow the validated Phase 1 process exactly
- Weekly metrics review becomes more important
- The risk of inter-clinic comparison creating adoption pressure is real — manage expectations across Practice Managers

**Phase 2 success leads directly to the full deployment decision.**

---

## 8. A Note on the Platform

Verve is, at this point, a well-built internal platform. The security architecture, the depth of the operational documentation, and the breadth of functionality delivered are all ahead of where most internal platforms of this type are at a comparable stage.

The pilot is not about discovering whether the platform works. It is about learning how your clinics use it, where the friction is, and what the real adoption patterns look like. That learning is only available from real usage.

The recommendation is to begin. The conditions are manageable. The risk is contained by the phased structure.

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*  
*Prepared for Daniel Blanco, Owner — JD Group.*
