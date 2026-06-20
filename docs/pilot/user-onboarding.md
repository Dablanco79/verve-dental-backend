# Verve Operational Suite — User Onboarding Checklist

**Version:** 1.0  
**Owner:** Daniel Blanco (Pilot Administrator)  
**Audience:** Pilot Administrator, Practice Managers  
**Classification:** Internal — Pilot Operations  
**Last Updated:** June 2026

---

## Purpose

This checklist ensures every pilot user is correctly set up in the Verve platform before they begin using it. Complete each step in order and confirm sign-off before handing access to the user.

One checklist per user. Retain completed checklists as part of the pilot evidence package.

---

## User Details

| Field | Value |
|-------|-------|
| Full Name | |
| Email Address | |
| Clinic | |
| Role | Practice Manager / Clinical Staff / Admin |
| Onboarding Date | |
| Completed By | |

---

## Step 1 — Create User Account

> **MANUAL OPERATOR ACTION REQUIRED:** User creation must be performed by the Pilot Administrator with admin access to the Verve platform.

- [ ] Navigate to **User Management** in Verve (Admin panel)
- [ ] Select **New User**
- [ ] Enter the user's full name
- [ ] Enter the user's work email address
- [ ] Set initial role (see Step 2)
- [ ] Set clinic assignment (see Step 3)
- [ ] Set initial status to **Active**
- [ ] Generate or set a **temporary password** (minimum 12 characters)
- [ ] Record the temporary password securely — do not send via unencrypted email
- [ ] Select **Create User**
- [ ] Confirm the user record appears in the User Management list

**Confirmed:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 2 — Assign Role

Available roles during the pilot:

| Role | Access Level |
|------|-------------|
| `admin` | Full platform access; user management; all modules |
| `practice_manager` | Clinic-scoped access; all modules except user management |
| `clinical_staff` | Clinic-scoped; roster (read), timesheets (own), leave (own), inventory (read) |

- [ ] Confirm the correct role for this user with their line manager or Daniel Blanco
- [ ] Navigate to the user's profile in User Management
- [ ] Select **Edit Role**
- [ ] Assign the appropriate role from the list above
- [ ] Save the role assignment
- [ ] Confirm the role is correctly reflected on the user's profile page

**Role assigned:** ______________________  
**Confirmed:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 3 — Verify Clinic Assignment

Each user must be associated with their clinic only. A user must not have access to other clinics' data.

- [ ] Navigate to the user's profile
- [ ] Confirm the **clinic** field shows the correct clinic name
- [ ] If clinic is incorrect or blank, select **Edit** and assign the correct clinic
- [ ] Confirm only the assigned clinic is visible (no other clinics listed)
- [ ] Save the clinic assignment

**Clinic assigned:** ______________________  
**Confirmed:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 4 — Enable MFA

MFA is mandatory for all Practice Managers and Admins. For Clinical Staff, confirm with Daniel Blanco whether MFA is required for this pilot cohort.

- [ ] Confirm MFA requirement for this user's role:
  - Admin: **Required**
  - Practice Manager: **Required**
  - Clinical Staff: **Check with Daniel Blanco**
- [ ] If required: advise the user MFA setup will be prompted on first login
- [ ] Confirm MFA is not pre-enrolled (user must complete this themselves on first login)
- [ ] Note in this checklist whether MFA is expected for this user

**MFA required for this user:** ☐ Yes / ☐ No  
**Reason if No:** _______________________________________________

---

## Step 5 — Verify Login

The user must log in successfully before onboarding is considered complete.

- [ ] Provide the user with:
  - Verve URL
  - Their email address
  - Their temporary password (via secure channel)
  - Instructions to change password on first login (direct to `staff-quick-start.md` or `manager-quick-start.md`)
- [ ] User confirms they have received login credentials
- [ ] User attempts first login
- [ ] User successfully changes their password
- [ ] User completes MFA setup (if required)
- [ ] User confirms they can see the Verve dashboard

**Login verified:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 6 — Verify Permissions

After the user has logged in, verify they can access only what is appropriate for their role.

- [ ] Confirm user can access their assigned modules (see role table in Step 2)
- [ ] Confirm user **cannot** access User Management (unless Admin role)
- [ ] Confirm user can only see data for their assigned clinic
- [ ] Confirm user cannot see other users' personal data (timesheets, leave) unless their role permits it
- [ ] Verify inventory access matches role (Practice Manager = read/write; Clinical Staff = read only)
- [ ] If any permission appears incorrect, escalate to Daniel Blanco immediately — do not proceed

**Permissions verified:** ☐ Yes / Initials: _______ / Date: _______  
**Any issues found:** ☐ None / ☐ Yes — describe: _______________________________________________

---

## Step 7 — Training Completed

The user must have read and understood the relevant quick start guide before being signed off.

- [ ] Provide the user with the appropriate quick start guide:
  - Practice Manager → `manager-quick-start.md`
  - Clinical Staff → `staff-quick-start.md`
- [ ] User confirms they have read the guide
- [ ] User has completed a brief orientation walkthrough with the Practice Manager or Pilot Administrator:
  - [ ] Shown how to log in and log out
  - [ ] Shown how to navigate to their primary module(s)
  - [ ] Shown how to report an issue (support process)
  - [ ] Advised what the platform is NOT used for (patient records, payroll, etc.)
- [ ] Any questions from the user have been answered and documented if relevant

**Training completed:** ☐ Yes / Initials: _______ / Date: _______

---

## Step 8 — Signed Off

Onboarding is complete only when all preceding steps are confirmed and both parties acknowledge.

- [ ] All checklist steps marked complete
- [ ] No outstanding access or permission issues
- [ ] User has working login with correct role and clinic
- [ ] User understands how to get support

**User acknowledgement:**  
"I confirm I have been set up in the Verve system, have read the quick start guide, and understand how to seek support during the pilot."

| Field | Value |
|-------|-------|
| User Signature / Confirmation | |
| Date | |
| Onboarding Officer | |
| Pilot Administrator Sign-Off (if different) | |

---

## Onboarding Register

Maintain a central register of all onboarded users for the pilot:

| Name | Email | Role | Clinic | Onboarded Date | MFA Active | Sign-Off |
|------|-------|------|--------|----------------|------------|---------|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

> **MANUAL OPERATOR ACTION REQUIRED:** Keep this register up to date. It is required for the pilot evidence package and informs the offboarding process.

---

*This document is part of the Verve Pilot Operations Package — Sprint P.*
