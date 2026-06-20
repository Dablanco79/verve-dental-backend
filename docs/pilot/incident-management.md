# Verve Operational Suite — Incident Management

**Version:** 1.0  
**Owner:** Daniel Blanco (Pilot Administrator)  
**Audience:** Pilot Administrators, Practice Managers  
**Classification:** Internal — Pilot Operations  
**Last Updated:** June 2026

---

## 1. Purpose

This document defines the incident management framework for the Verve internal pilot. It establishes how incidents are classified, who responds, within what timeframe, and how incidents are formally closed.

Clinical operations must never be halted pending resolution of a platform incident. Always apply manual workarounds and continue care delivery first.

---

## 2. Incident Severity Levels

### 2.1 Critical — Severity 1

| Field | Detail |
|-------|--------|
| Definition | Platform is completely unavailable, a security breach has occurred, or there is confirmed or suspected data loss/corruption |
| Business impact | All pilot users unable to work on the platform; potential risk to clinic data or patient records |
| Response target | Immediate — escalate within **15 minutes** of detection |
| Resolution target | **4 hours** |
| Out-of-hours | Yes — escalate immediately regardless of time |

**Examples of Critical incidents:**

- Verve is completely unreachable for all users
- Confirmed unauthorised access to the platform
- Database connection failures causing data read/write errors
- A user's data (timesheets, stock records) has been permanently lost or corrupted
- MFA bypassed or authentication service down
- Redis session store failure causing all sessions to be dropped
- Backup failure verified on the same day as a primary failure

---

### 2.2 High — Severity 2

| Field | Detail |
|-------|--------|
| Definition | A core module is unavailable or significantly impaired; multiple users are affected; no acceptable workaround |
| Business impact | A clinic cannot complete a key operational function (e.g. cannot submit timesheets, cannot view roster) |
| Response target | **Acknowledge within 30 minutes**; begin investigation within **1 hour** |
| Resolution target | **8 business hours** |
| Out-of-hours | Escalate if blocking next-business-day operations |

**Examples of High incidents:**

- Inventory module is inaccessible or showing incorrect stock figures for all products
- Timesheet submission is failing for all users at a clinic
- Leave requests cannot be submitted or approved
- Roster is missing or blank for all staff at a clinic
- Purchase orders cannot be created or approved
- Analytics dashboard is completely blank or throwing errors
- A specific user is permanently locked out and cannot regain access via standard reset

---

### 2.3 Medium — Severity 3

| Field | Detail |
|-------|--------|
| Definition | A non-critical function is impaired or producing unexpected results; a workaround exists |
| Business impact | Limited; one user or one function affected; operations can continue |
| Response target | **Acknowledge within 4 hours** (business hours) |
| Resolution target | **Next 2 business days** |
| Out-of-hours | Log and review next business day |

**Examples of Medium incidents:**

- Forecast recommendations appear stale or incorrect for some products
- A specific inventory adjustment is not saving (but others work)
- A single user cannot log in (others can)
- Analytics data is delayed beyond the expected refresh window
- Password reset email is delayed > 10 minutes
- Purchase order PDF export failing
- A roster shift shows the wrong time for one staff member

---

### 2.4 Low — Severity 4

| Field | Detail |
|-------|--------|
| Definition | Minor usability issue, cosmetic defect, or documentation gap; no operational impact |
| Business impact | Nil or negligible |
| Response target | **Acknowledge within 1 business day** |
| Resolution target | Next sprint / scheduled patch |
| Out-of-hours | Log for review next business day |

**Examples of Low incidents:**

- A label or heading is misspelled or confusing
- A table column is misaligned in a specific browser
- A filter option does not sort in the expected order
- Help text is missing or unhelpful
- A confirmation message does not appear after saving
- An exported report has minor formatting issues

---

## 3. Response Expectations

### 3.1 Response Summary

| Severity | Acknowledge | Begin Investigation | Resolution Target |
|----------|------------|---------------------|-------------------|
| Critical | 15 minutes | Immediately | 4 hours |
| High | 30 minutes | 1 hour | 8 business hours |
| Medium | 4 hours (business hours) | Same day | 2 business days |
| Low | 1 business day | Next sprint cycle | Scheduled patch |

### 3.2 Business Hours Definition

Monday – Friday, 8:00 AM – 6:00 PM AEST (Australian Eastern Standard Time).

Out-of-hours escalation for Critical incidents uses the direct mobile contact provided to Practice Managers during onboarding.

### 3.3 Status Updates

During active Critical and High incidents:

- Initial status update to all affected users: within 30 minutes of detection
- Progress updates: every 60 minutes until resolved
- Resolution confirmation: as soon as resolved

Updates are delivered via the communication channel established for the clinic (email or direct message).

---

## 4. Escalation Path

```
Detection
  ↓
Staff Member / Practice Manager detects and reports
  ↓
Practice Manager
  ├─ Low / Medium → Log via support channel; monitor
  └─ High / Critical → Escalate immediately to Daniel Blanco
         ↓
  Daniel Blanco (Pilot Administrator)
  ├─ Assesses severity
  ├─ Initiates communication to affected users
  └─ Engages technical resources
         ↓
  Technical / Infrastructure Team
  ├─ Investigates root cause
  ├─ Applies fix or applies workaround
  └─ Confirms resolution
         ↓
  Daniel Blanco
  ├─ Validates resolution
  ├─ Sends resolution notice to affected users
  └─ Initiates incident closure
         ↓
  Incident Record Updated and Closed
```

---

## 5. Communication Templates

### 5.1 Critical Incident — Initial Notification

```
Subject: [CRITICAL] Verve System Incident — [Date] [Time]

Hi [Clinic Name] Team,

We have identified a critical issue with the Verve platform affecting [describe impact briefly].

Current status: Under active investigation.
Estimated resolution: We will provide an update within 60 minutes.

Manual workaround: [Describe workaround if applicable, e.g. revert to paper-based process for timesheets.]

Please do not attempt to re-enter data at this stage — await guidance before resuming normal platform use.

Updates will follow every 60 minutes or sooner.

— Daniel Blanco, Pilot Administrator
```

---

### 5.2 High Incident — Initial Notification

```
Subject: [HIGH] Verve Issue — [Module/Function] — [Date]

Hi [Clinic Name] Team,

We are aware of an issue with [module or function] in Verve affecting [brief description of impact].

Current status: Under investigation.
Workaround: [Describe workaround or state "None at this time."]

We expect to have an update for you within [timeframe].

Please continue operations using [manual process / alternative] in the meantime.

— Daniel Blanco, Pilot Administrator
```

---

### 5.3 Incident Resolution Notice

```
Subject: [RESOLVED] Verve Incident — [Date] — [Brief Description]

Hi [Clinic Name] Team,

The issue affecting [module/function] has been resolved as of [time].

Root cause: [Brief, non-technical explanation.]
Action taken: [Brief description of fix.]
Data impact: [None / [describe any data that was affected and how it has been addressed]]

You may now resume normal use of the platform.

If you notice any continuing issues, please report them via the usual support process.

Thank you for your patience during this.

— Daniel Blanco, Pilot Administrator
```

---

### 5.4 Incident Escalation to Owner

```
Subject: [ESCALATION] Critical Verve Incident — Immediate Attention Required

Daniel,

A critical incident has been identified with the Verve platform.

Time detected: [Time]
Reported by: [Name / Clinic]
Impact: [Description]
Current status: [What is known]
Action taken so far: [None / [describe]]

Your input is required to: [authorise infrastructure action / contact hosting provider / communicate to clinic]

Contact: [Name] at [Phone/Email]
```

---

## 6. Incident Closure Process

An incident is formally closed when all of the following are confirmed:

| Closure Criterion | Verified By |
|------------------|-------------|
| Root cause identified | Technical team |
| Fix applied or workaround confirmed as adequate | Technical team |
| All affected users notified of resolution | Daniel Blanco |
| Platform function verified normal | Practice Manager |
| Incident record updated with closure details | Daniel Blanco |
| Post-incident review scheduled (for Critical/High) | Daniel Blanco |

### 6.1 Incident Record Requirements

Every incident — regardless of severity — must be logged with:

- Date and time detected
- Date and time reported
- Reported by
- Severity classification
- Description of impact
- Actions taken (with timestamps)
- Root cause (when known)
- Resolution details
- Date and time closed
- Follow-up actions required (if any)

> **MANUAL OPERATOR ACTION REQUIRED:** An incident log (spreadsheet or equivalent) must be maintained by the Pilot Administrator throughout the pilot. This log forms part of the pilot evidence package at phase close.

### 6.2 Post-Incident Review (Critical and High)

Within 3 business days of closing a Critical or High incident:

1. Review the incident timeline
2. Identify the root cause
3. Assess whether the response was within SLA
4. Identify any preventive action
5. Document findings
6. Communicate changes to affected users where relevant

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*
