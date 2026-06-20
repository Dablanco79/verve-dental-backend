# Verve Operational Suite — Pilot Support Process

**Version:** 1.0  
**Owner:** Daniel Blanco (Pilot Administrator)  
**Audience:** All Pilot Users  
**Classification:** Internal — Pilot Operations  
**Last Updated:** June 2026

---

## 1. Purpose

This document defines how pilot participants report issues, what information to include, who handles support, and what response times to expect.

Clear, consistent reporting allows issues to be resolved faster and helps the team identify patterns that inform improvements.

---

## 2. How Staff Report Issues

### 2.1 Reporting Channels (by Priority)

| Channel | Use For | Who Uses It |
|---------|---------|-------------|
| **Practice Manager (direct)** | First point of contact for all issues | Clinical staff |
| **Email to Pilot Administrator** | Issues escalated by Practice Manager; issues Practice Manager cannot resolve | Practice Managers |
| **Direct contact — Daniel Blanco** | Critical incidents only; unresponsive escalation chain | Practice Managers |

> **MANUAL OPERATOR ACTION REQUIRED:** Before pilot launch, Daniel Blanco must provide Practice Managers with:
> - A dedicated support email address or shared inbox
> - A direct mobile number for Critical/out-of-hours incidents
> - Confirmation of any chat-based support channel (e.g. Teams, WhatsApp group)

### 2.2 Reporting Flow — Clinical Staff

```
Staff Member detects issue
  ↓
Attempt basic fix (refresh browser, re-login)
  ↓
Still an issue?
  ↓
Report to Practice Manager
  → Provide: what happened, time, error message, screenshot
  ↓
Practice Manager assesses and escalates if required
```

### 2.3 Reporting Flow — Practice Managers

```
Practice Manager detects or receives a report
  ↓
Classify severity (use incident-management.md as reference)
  ↓
Critical or High?
  → Yes: Contact Daniel Blanco immediately
  → No: Submit via support email with full details
  ↓
Await acknowledgement
  ↓
Follow up if response not received within SLA window
```

---

## 3. Required Information When Reporting

Incomplete reports slow resolution. Every report must include the following where possible:

### 3.1 Mandatory Information

| Field | What to Provide |
|-------|----------------|
| **Reporter name** | Full name |
| **Clinic** | Clinic name |
| **Date and time** | When the issue occurred or was first noticed |
| **What you were trying to do** | e.g. "Submitting a timesheet for 19 June 2026" |
| **What happened instead** | e.g. "Page went blank after clicking Submit" |
| **Error message** | Exact text if one appeared; "No message shown" if none |
| **Severity assessment** | Your best assessment: Critical / High / Medium / Low |

### 3.2 Strongly Recommended

| Field | Why It Helps |
|-------|-------------|
| **Screenshot** | Confirms exactly what the user saw; often resolves ambiguity |
| **Video recording** | For intermittent or hard-to-reproduce issues |
| **Steps to reproduce** | Numbered steps to recreate the issue |
| **Frequency** | Is this the first time? Does it happen every time? |

### 3.3 How to Take a Screenshot

**Windows:**
- Press `Windows + Shift + S` to select a region
- The screenshot is copied to your clipboard — paste into an email or Word document
- Alternatively, press `Print Screen` to capture the full screen

**Mac:**
- Press `Command + Shift + 4` to select a region
- The screenshot is saved to your Desktop

**Browser (all platforms):**
- Press `F12` to open developer tools
- Go to the Console tab if there are error messages visible — include a screenshot of this too

---

## 4. Browser Information to Include

For display or behaviour issues, include your browser details:

| Information | How to Find It |
|-------------|----------------|
| Browser name | e.g. "Google Chrome", "Microsoft Edge", "Safari" |
| Browser version | Chrome: Menu → Help → About Google Chrome |
| Operating system | e.g. "Windows 11", "macOS Ventura" |
| Screen size / device | e.g. "15-inch laptop", "desktop monitor" |
| Zoom level | Look at the browser zoom setting (usually in the View menu) |

> Most issues can be resolved or diagnosed without browser details, but for layout and display bugs this information is critical.

---

## 5. Expected Response Times

| Severity | Acknowledgement | Resolution Target |
|----------|----------------|-------------------|
| Critical | 15 minutes (any time) | 4 hours |
| High | 30 minutes (business hours) | 8 business hours |
| Medium | 4 hours (business hours) | 2 business days |
| Low | 1 business day | Scheduled patch |

Business hours: Monday – Friday, 8:00 AM – 6:00 PM AEST.

### What "Acknowledgement" Means

An acknowledgement means you will receive a response confirming:
- The issue has been received
- It has been given a severity classification
- An expected timeframe for resolution or investigation

### If You Do Not Receive a Response

| Wait Time | Action |
|-----------|--------|
| Critical — no response in 30 minutes | Call Daniel Blanco directly |
| High — no response in 1 hour (business hours) | Call Daniel Blanco directly |
| Medium — no response in 1 business day | Send a follow-up email; reference your original report |
| Low — no response in 3 business days | Follow up via email |

---

## 6. Escalation Ownership

| Stage | Owner | Responsibility |
|-------|-------|----------------|
| First contact | Practice Manager | Receive report, attempt basic resolution, classify severity |
| Support triage | Daniel Blanco | Acknowledge, classify formally, assign to technical team if required |
| Technical resolution | Technical / Infrastructure team | Root cause investigation and fix |
| Resolution communication | Daniel Blanco | Notify affected users; confirm closure |
| Closure confirmation | Practice Manager | Confirm platform function is restored at clinic level |

---

## 7. Support During the Pilot — What to Expect

The pilot support model is intentionally lightweight. This is not a full service desk — it is a direct, low-overhead process between clinics and the Pilot Administrator.

| Expectation | Detail |
|-------------|--------|
| No ticketing system | Issues are tracked manually by the Pilot Administrator |
| Direct human response | No automated bot or queue — real responses from a real person |
| Feedback welcome | Questions and improvement suggestions are valued, not just bugs |
| Honest status updates | If an issue cannot be resolved quickly, you will be told clearly |
| No issue too small | Low-priority items are still worth reporting — patterns matter |

---

## 8. What Is Not In Scope for Pilot Support

| Out of Scope | Why |
|--------------|-----|
| Payroll queries | Timesheets are recorded in Verve but payroll remains in existing systems |
| Patient records | Not part of the Verve platform |
| Billing or invoicing | Not yet implemented |
| Hardware or network issues at the clinic | Handled by existing IT support |
| Personal device issues (phone, browser setup) | Out of platform scope |

---

## 9. Pilot Support Contact Summary

> **MANUAL OPERATOR ACTION REQUIRED:** Complete the table below before pilot launch and distribute to all Practice Managers.

| Contact | Name | Contact Method | Available Hours |
|---------|------|----------------|-----------------|
| Pilot Administrator | Daniel Blanco | Email: [INSERT] | 8am–6pm AEST Mon–Fri |
| Critical / Out-of-hours | Daniel Blanco | Mobile: [INSERT] | 24/7 for Critical only |
| Support Email Inbox | — | [INSERT] | Business hours |

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*
