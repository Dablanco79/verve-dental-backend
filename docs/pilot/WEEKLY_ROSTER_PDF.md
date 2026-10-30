# Weekly roster PDF export

`GET /api/v1/clinics/:clinicId/roster/export.pdf?weekStart=YYYY-MM-DD`
downloads the selected clinic's current Monday-to-Sunday roster as an A4
landscape PDF.

## Access and tenant boundaries

- Authentication and `module:roster` are required.
- Only Owner/Admin and Group Practice Manager roles can export.
- GPM access to a non-home clinic requires an operational clinic assignment.
- Organisation scope, clinic scope and PostgreSQL tenant context are established
  before roster or clinic-logo data is read.
- Clinical staff cannot export a clinic-wide roster.

## Document semantics

- The PDF represents current roster records when the request is made. RENQOR
  does not currently have a roster publication state.
- Cancelled shifts are excluded. Scheduled, confirmed and completed shifts are
  included.
- Approved leave is shown only as `Approved Leave`; reasons and pending requests
  are excluded.
- Scheduled hours are elapsed roster duration clipped to the selected week.
  They are not payroll-approved or payable hours, and no unpaid-break deduction
  is invented.
- Overnight shifts are assigned once, to their local start date. A shift that
  began before the week and continues into Monday is shown once on Monday.
- The clinic's configured IANA timezone controls week boundaries and display.

The clinic's normalized uploaded logo is used when present. If no logo exists,
the clinic name remains the document heading.

To bound server memory and PDF generation time, one export is limited to 500
staff members and 5,000 non-cancelled shifts. Oversized requests return HTTP
413 instead of attempting partial output.

Roster publication, automated emails, attachments and monthly calendar PDFs are
deferred.
