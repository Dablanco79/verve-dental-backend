# Verve Operational Suite — User Offboarding Checklist

**Version:** 1.0  
**Owner:** Daniel Blanco (Pilot Administrator)  
**Audience:** Pilot Administrator, Practice Managers  
**Classification:** Internal — Pilot Operations  
**Last Updated:** June 2026

---

## Purpose

This checklist ensures that when a pilot user's access to Verve is no longer required — whether because the pilot phase has ended, the user has left the organisation, changed role, or is being removed for any other reason — their access is cleanly and verifiably terminated.

Offboarding must be completed promptly. There is no grace period. If a user should not have access, that access must be removed the same business day.

Complete one checklist per user. Retain completed checklists as part of the pilot evidence package.

---

## Reason for Offboarding

| Reason | Description |
|--------|-------------|
| Pilot phase complete | All users offboarded at end of pilot |
| Staff departure | User has left the organisation or the clinic |
| Role change | User's role no longer requires Verve access |
| Voluntary withdrawal | User has opted out of the pilot |
| Security concern | Access removed pending investigation |
| Other | Specify in notes below |

**Reason for this offboarding:**  
☐ Pilot complete / ☐ Staff departure / ☐ Role change / ☐ Withdrawal / ☐ Security / ☐ Other: _______________

---

## User Details

| Field | Value |
|-------|-------|
| Full Name | |
| Email Address | |
| Clinic | |
| Role at Time of Offboarding | |
| Offboarding Date | |
| Completed By | |
| Authorised By | |

---

## Step 1 — Disable Access

Disabling the user's account immediately prevents further login without deleting any records they have created.

> **MANUAL OPERATOR ACTION REQUIRED:** Account management must be performed by the Pilot Administrator with admin access to the Verve platform.

- [ ] Navigate to **User Management** in Verve (Admin panel)
- [ ] Search for and open the user's profile
- [ ] Select **Deactivate Account** (or equivalent status change to Inactive/Disabled)
- [ ] Confirm the account status shows as **Inactive** or **Disabled**
- [ ] Confirm the user's email address can no longer be used to log in (attempt a test login if unsure)
- [ ] Record the date and time access was disabled

**Access disabled at:** _______________________ (Date / Time)  
**Confirmed:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 2 — Verify MFA No Longer Active

Disabling the account should prevent MFA from being used, but verify this explicitly.

- [ ] Confirm the user account status is Inactive/Disabled (from Step 1)
- [ ] Confirm that a login attempt using the user's credentials is rejected at the **password stage** (before MFA is even requested)
- [ ] Confirm that MFA tokens for this account cannot be used to access the system
- [ ] If the user had MFA backup codes: advise them (if appropriate) that their backup codes are void

> If there is any indication that the account can still be accessed despite being disabled, escalate to Daniel Blanco immediately and classify as a High incident.

**MFA verified inactive:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 3 — Remove Permissions

After disabling the account, explicitly review and remove any active role assignments to prevent accidental re-enablement with elevated access.

- [ ] Navigate to the user's profile in User Management
- [ ] Review the **Role** field
- [ ] Change the role to **None** or the lowest-privilege role available (e.g. `inactive_user` if such a role exists)
- [ ] Remove any explicit clinic assignments if the platform supports this
- [ ] Confirm no active API tokens, OAuth grants, or session tokens remain associated with this user (if visible in the admin interface)
- [ ] Save the changes

**Permissions cleared:** ☐ Yes / Initials: _______ / Date: _______  
**Role at offboarding:** _______________________  
**Role set to after offboarding:** _______________________

---

## Step 4 — Confirm Account State

Before proceeding, confirm the full account state is correct.

- [ ] Account status: **Inactive / Disabled**
- [ ] Role: **None / Lowest privilege**
- [ ] Clinic assignment: **Removed or retained (for record purposes only)**
- [ ] Last login date is recorded (useful for audit)
- [ ] Account cannot be used to log in

**Final account state confirmed:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 5 — Audit Verification

Confirm that the audit trail reflects the offboarding correctly and that no data has been altered as part of this process.

- [ ] Check the platform audit log (if accessible) for this user's account:
  - Confirm last login date and time is recorded
  - Confirm the deactivation event is logged
  - Confirm no unexpected activity in the last 24 hours before deactivation
- [ ] All data created by this user (adjustments, timesheets, leave requests) remains in the system and is **not deleted**
- [ ] Confirm no records appear to have been modified or deleted immediately prior to offboarding
- [ ] If any anomalies are found, log them and escalate to Daniel Blanco before proceeding

**Audit verified:** ☐ Yes / Initials: _______ / Date: _______  
**Anomalies found:** ☐ None / ☐ Yes — describe: _______________________________________________

---

## Step 6 — Update the Onboarding Register

The onboarding register (`user-onboarding.md`) must be updated to reflect the offboarding.

- [ ] Open the Onboarding Register maintained during the pilot
- [ ] Locate the user's row
- [ ] Add the offboarding date and confirm access removed
- [ ] Mark the user as **Offboarded**

**Register updated:** ☐ Yes / Initials: _______ / Date: _______

---

## Offboarding Sign-Off

Offboarding is complete when all preceding steps are confirmed.

| Field | Value |
|-------|-------|
| Offboarding completed by | |
| Date completed | |
| Authorised by (Pilot Administrator) | |
| Date authorised | |
| Notes / Reason for any incomplete steps | |

---

## Bulk Offboarding (End of Pilot)

At the close of the pilot, all users must be offboarded unless they are transitioning to full deployment access.

> **MANUAL OPERATOR ACTION REQUIRED:** At pilot close, the Pilot Administrator must review all user accounts and deactivate any not continuing to the next phase. This review must be completed within 2 business days of the pilot close date.

Bulk offboarding checklist:

- [ ] Export full user list from User Management
- [ ] Mark each user as: **Retain for deployment** / **Offboard**
- [ ] Offboard all users marked for offboarding (use individual checklists above)
- [ ] Confirm the final active user list matches only those authorised for the next phase
- [ ] Retain all offboarding checklists in the pilot evidence package

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*
