# Monthly Roster Calendar PDF

The Roster page allows authorised Owner/Admin and Group Practice Manager users
with `module:roster` to export one clinic's current roster as a monthly
calendar PDF.

## Manager workflow

1. Select one clinic in the global clinic selector. **All Clinics** cannot be
   exported as a combined roster.
2. In **Export Roster PDF**, choose **Monthly Calendar**.
3. Select the calendar month.
4. Select **A3 Landscape** (default) or **A4 Landscape**.
5. Choose **Export Monthly PDF**.

The selected month initially follows the roster period being viewed. The
server revalidates the user's organisation, clinic access, role, and
`module:roster` permission; frontend visibility is not an authorisation
boundary.

## Calendar contents

- Calendar weeks run Monday to Sunday.
- Scheduled, confirmed, and completed shifts are attributed to their
  clinic-local start date. Cancelled shifts are excluded.
- Overnight shifts show the following day's finish explicitly.
- Approved leave is shown as `Staff name — Leave`.
- Pending, rejected, withdrawn, and cancelled leave is not shown.
- Clinic branding uses the exact selected clinic's uploaded logo. The clinic
  name remains the fallback when no logo exists.

Adjacent-month dates are muted and never contain out-of-month roster entries.
Every page contains `Printed from RENQOR`.

## Busy dates and continuation pages

The main calendar shows as many complete entries as fit legibly in each day.
If a date contains additional entries, the cell displays a
`+ N more — see continuation` marker. Remaining entries appear exactly once
on ordered continuation pages that repeat the clinic, month, branding, date,
and RENQOR footer.

Entries and names are wrapped rather than silently truncated. Additional pages
are preferred over reducing text below the paper-specific readable size.

## Operational meaning and privacy

The PDF represents the current roster data at export time. RENQOR does not
currently maintain a separate published-roster state.

The calendar is operational only. It does not calculate or guarantee
payroll-approved hours, payable leave hours, break deductions, pay rates,
salaries, or payroll totals. It excludes employee contact details, leave
reasons, medical information, and internal shift notes.

Automatic publication emails and roster attachments are deferred to a future
phase.
