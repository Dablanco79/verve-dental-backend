# Verve Operational Suite — Pilot Success Metrics

**Version:** 1.0  
**Owner:** Daniel Blanco (Pilot Administrator)  
**Audience:** Daniel Blanco, Practice Managers  
**Classification:** Internal — Pilot Operations  
**Last Updated:** June 2026

---

## Purpose

This document defines the metrics used to evaluate the success of the Verve internal pilot. Each metric includes a target, measurement method, and the threshold required to consider the metric passed.

Metrics are reviewed weekly by the Pilot Administrator. The full metrics package informs the go/no-go decision at the end of each pilot phase.

---

## Measurement Cadence

| Cadence | Activities |
|---------|-----------|
| Daily | Check for Critical or High incidents; review support queue |
| Weekly | Review all metrics; update tracker; share summary with Practice Managers |
| Phase close | Full metrics evaluation; complete go/no-go checklist |

> **MANUAL OPERATOR ACTION REQUIRED:** Maintain a weekly metrics tracking spreadsheet. Record each metric's actual value weekly against its target. This forms part of the pilot evidence package.

---

## Metric Definitions

---

### M1 — Login Success Rate

| Field | Detail |
|-------|--------|
| Description | Percentage of login attempts that result in a successful authenticated session |
| Why It Matters | Confirms the authentication system is reliable under real-world usage |
| Target | ≥ 98% of login attempts succeed |
| Measurement Method | Review authentication logs or platform analytics; count successful logins ÷ total login attempts × 100 |
| Success Threshold | ≥ 98% |
| Failure Indicator | < 95% or multiple user reports of consistent login failures |
| Reporting Frequency | Weekly |

---

### M2 — MFA Enrollment Rate

| Field | Detail |
|-------|--------|
| Description | Percentage of users required to use MFA who have successfully enrolled |
| Why It Matters | Confirms security controls are active across the pilot user base |
| Target | 100% of required users enrolled before or at first login |
| Measurement Method | Review User Management — count MFA-enrolled users against total required-MFA users |
| Success Threshold | 100% |
| Failure Indicator | Any required user not enrolled after their first login |
| Reporting Frequency | At onboarding completion; checked weekly thereafter |

---

### M3 — Inventory Adjustment Usage

| Field | Detail |
|-------|--------|
| Description | Number of inventory adjustments submitted per week per clinic |
| Why It Matters | Confirms the inventory module is being actively used, not just accessed |
| Target | ≥ 3 adjustments per clinic per week (Phase 1 baseline) |
| Measurement Method | Review inventory adjustment history; count submissions per clinic per 7-day period |
| Success Threshold | ≥ 3 per clinic per week |
| Failure Indicator | Zero adjustments in a week — may indicate non-use or a submission failure |
| Reporting Frequency | Weekly |
| Notes | The target reflects a minimum active usage signal, not a specific clinical volume |

---

### M4 — Forecast Usage

| Field | Detail |
|-------|--------|
| Description | Whether Practice Managers are viewing and engaging with the materials forecast |
| Why It Matters | Confirms forecast module adoption; validates the value proposition |
| Target | ≥ 1 forecast review per Practice Manager per week |
| Measurement Method | Review analytics / page view data for the forecast module; direct Practice Manager confirmation if analytics unavailable |
| Success Threshold | ≥ 1 review per PM per week |
| Failure Indicator | No engagement with the forecast module for 2+ consecutive weeks |
| Reporting Frequency | Weekly |

---

### M5 — Roster Usage

| Field | Detail |
|-------|--------|
| Description | Whether rosters are being created and published in Verve (as opposed to external tools) |
| Why It Matters | Confirms roster module adoption |
| Target | ≥ 1 roster published per clinic per week |
| Measurement Method | Review roster history; confirm rosters are published (not in draft) |
| Success Threshold | ≥ 1 published roster per clinic per week |
| Failure Indicator | No published roster for 2 consecutive weeks; or roster published externally and not reflected in Verve |
| Reporting Frequency | Weekly |

---

### M6 — Timesheet Submission Usage

| Field | Detail |
|-------|--------|
| Description | Percentage of enrolled staff who have submitted at least one timesheet in the reporting period |
| Why It Matters | Confirms timesheet adoption across the staff cohort |
| Target | ≥ 80% of enrolled staff submit at least one timesheet per 2-week period |
| Measurement Method | Count unique staff with ≥ 1 timesheet submission ÷ total enrolled staff × 100 |
| Success Threshold | ≥ 80% |
| Failure Indicator | < 60% submission rate, or zero submissions from a specific clinic |
| Reporting Frequency | Fortnightly (aligned to pay period if applicable) |

---

### M7 — Leave Request Usage

| Field | Detail |
|-------|--------|
| Description | Whether staff are submitting leave requests via Verve |
| Why It Matters | Confirms leave module adoption; validates move away from manual leave tracking |
| Target | All leave requests during the pilot period submitted via Verve (not paper/email) |
| Measurement Method | Practice Manager confirmation; cross-reference with any non-Verve leave requests |
| Success Threshold | 100% of leave requests submitted via Verve |
| Failure Indicator | Leave requests submitted outside of Verve without a documented reason |
| Reporting Frequency | Weekly |
| Notes | Exceptions acceptable for technical failures; document when this occurs |

---

### M8 — System Availability

| Field | Detail |
|-------|--------|
| Description | Percentage of time the Verve platform is accessible and functional |
| Why It Matters | Core reliability metric; platform unavailability directly impacts clinic operations |
| Target | ≥ 99% uptime during business hours (Mon–Fri, 8am–6pm AEST) |
| Measurement Method | Track any reported or detected downtime; calculate downtime minutes ÷ total business-hours minutes × 100 |
| Success Threshold | ≥ 99% (allows ≈ 6 minutes downtime per 10-hour business day) |
| Failure Indicator | Any unplanned downtime > 30 minutes; any Critical availability incident |
| Reporting Frequency | Weekly; incident-triggered |

---

### M9 — Support Ticket Volume

| Field | Detail |
|-------|--------|
| Description | Number and severity of support tickets raised during the pilot |
| Why It Matters | High ticket volume may indicate usability issues, reliability problems, or training gaps |
| Targets | Total tickets ≤ 10/week; High severity ≤ 2/week; Critical = 0 per week |
| Measurement Method | Count tickets by severity from the support log maintained by the Pilot Administrator |
| Success Threshold | Weekly average ≤ 10 total; ≤ 2 High per week; 0 Critical per week |
| Failure Indicator | > 5 High tickets in a single week; any unresolved Critical ticket |
| Reporting Frequency | Weekly |

---

### M10 — Critical Incident Count

| Field | Detail |
|-------|--------|
| Description | Total number of Critical-severity incidents declared during the pilot |
| Why It Matters | Critical incidents represent the highest risk to the pilot's success and user trust |
| Target | 0 Critical incidents per phase |
| Measurement Method | Count all incidents classified as Critical in the incident log |
| Success Threshold | 0 per phase |
| Failure Indicator | Any Critical incident; > 1 High incident resolved outside SLA |
| Reporting Frequency | Real-time (any Critical triggers immediate review); weekly summary |

---

### M11 — User Satisfaction Score

| Field | Detail |
|-------|--------|
| Description | Average satisfaction score from pilot users based on the weekly feedback survey |
| Why It Matters | Quantifies whether the platform is meeting user needs and is fit for broader rollout |
| Target | ≥ 3.5 / 5.0 average |
| Measurement Method | Weekly feedback survey (see `pilot-feedback.md`); average all scores per phase |
| Success Threshold | ≥ 3.5 / 5.0 |
| Failure Indicator | Average < 3.0, or consistent declining scores over 3 consecutive weeks |
| Reporting Frequency | Weekly |
| Survey Question | "Overall, how satisfied are you with the Verve platform this week? (1 = Very Unsatisfied, 5 = Very Satisfied)" |

---

## Metrics Summary Table

| # | Metric | Target | Success Threshold | Failure Indicator |
|---|--------|--------|------------------|-------------------|
| M1 | Login Success Rate | ≥ 98% | ≥ 98% | < 95% |
| M2 | MFA Enrollment Rate | 100% | 100% | Any unenrolled required user |
| M3 | Inventory Adjustment Usage | ≥ 3/clinic/week | ≥ 3/clinic/week | Zero in any week |
| M4 | Forecast Usage | ≥ 1 review/PM/week | ≥ 1/week | No engagement 2+ weeks |
| M5 | Roster Usage | ≥ 1 published/clinic/week | ≥ 1/week | No published roster 2+ weeks |
| M6 | Timesheet Submission | ≥ 80% of staff/fortnight | ≥ 80% | < 60% |
| M7 | Leave Request Usage | 100% via Verve | 100% | Any outside Verve (undocumented) |
| M8 | System Availability | ≥ 99% business hours | ≥ 99% | Any downtime > 30 min |
| M9 | Support Ticket Volume | ≤ 10/week; ≤ 2 High/week | Within targets | > 5 High/week |
| M10 | Critical Incident Count | 0 per phase | 0 | Any Critical |
| M11 | User Satisfaction | ≥ 3.5 / 5.0 | ≥ 3.5 | < 3.0 or consistent decline |

---

## Weekly Metrics Tracker Template

> Copy this table weekly and record actuals.

| Week | M1 Login | M2 MFA | M3 Inventory | M4 Forecast | M5 Roster | M6 Timesheet | M7 Leave | M8 Uptime | M9 Tickets | M10 Critical | M11 Satisfaction |
|------|---------|--------|-------------|------------|---------|-------------|---------|---------|-----------|------------|----------------|
| Week 1 | | | | | | | | | | | |
| Week 2 | | | | | | | | | | | |
| Week 3 | | | | | | | | | | | |
| Week 4 | | | | | | | | | | | |
| Week 5 | | | | | | | | | | | |
| Week 6 | | | | | | | | | | | |

**Phase Assessment:**  
- All metrics at threshold: ✅ **PASS**  
- 1–2 metrics below threshold (non-critical): ⚠️ **CONDITIONAL PASS** — document remediation  
- Any critical threshold failed: ❌ **FAIL** — escalate to Daniel Blanco before phase close

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*
