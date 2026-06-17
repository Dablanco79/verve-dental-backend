/**
 * One-off script: generates GPT handoff Word document.
 * Run: node docs/generate-handoff-doc.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "Verve_Project_Handoff_Summary_June_2026.docx");

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 180 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, ...opts })],
  });
}
function bullet(text) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } });
}
function bullet2(text) {
  return new Paragraph({ text, bullet: { level: 1 }, spacing: { after: 40 } });
}

const children = [
  h1("Verve Dental Operational Suite — Project Handoff Summary"),
  p("Prepared: June 2026", { italics: true }),
  p("Purpose: Context document for GPT-assisted development continuation. Covers everything built to date (through frontend lint/error fixes) and remaining work.", { italics: true }),

  h2("1. Executive Summary"),
  p("The Verve Dental Operational Suite is a multi-tenant dental practice management platform targeting 100+ Australian clinics. It is structured as an npm monorepo with Backend (Node.js/TypeScript/Express), Frontend-Web (React 19/TypeScript/Vite 6), and a placeholder Mobile-app folder."),
  p("Current status as of June 2026:"),
  bullet("258/258 backend tests passing (12 test suites)"),
  bullet("Frontend production build succeeds (tsc + vite build)"),
  bullet("Frontend ESLint: 0 errors (1 non-blocking warning in AuthContext.tsx about react-refresh)"),
  bullet("0 TypeScript errors in both workspaces"),
  bullet("System Integration & Stabilization phase marked COMPLETE"),
  bullet("Deployed to Render: verve-dental-api.onrender.com (API) and verve-dental-frontend.onrender.com (web)"),

  h2("2. Repository Structure"),
  bullet("Backend/ — API server, services, repositories, migrations, tests"),
  bullet("Frontend-Web/ — React web application"),
  bullet("Mobile-app/ — Placeholder only (React Native deferred)"),
  bullet("docs/ — ADRs, build roadmap, this handoff document"),
  bullet("A_PROJECT_MEMORY.md — Cursor long-term memory (detailed module notes)"),
  bullet("Root package.json — npm workspaces; scripts: dev:backend, dev:web, build, test, lint, typecheck"),
  bullet(".github/workflows/ci.yml — CI: lint, typecheck, test, web build"),

  h2("3. Technology Stack"),
  h3("Backend"),
  bullet("Node.js 20+, TypeScript (strict), Express"),
  bullet("Zod validation, Pino logging, bcrypt, JWT (15m access + 7d refresh)"),
  bullet("PostgreSQL when DATABASE_URL is set; in-memory repositories as fallback for local dev/tests"),
  bullet("Bootstrap migration runner in db/migrate.ts (applies schemas on cold start)"),
  bullet("Redis client scaffolded (Backend/src/redis/client.ts)"),
  h3("Frontend"),
  bullet("React 19, TypeScript strict, Vite 6, React Router"),
  bullet("AuthProvider with access/refresh token session restore"),
  bullet("VITE_API_BASE_URL empty = same-origin via Vite proxy; full URL in production"),

  h2("4. Security & Multi-Tenant Architecture"),
  bullet("RBAC roles: owner_admin, group_practice_manager, clinical_staff"),
  bullet("JWT payload includes homeClinicId (permanent payroll/contract clinic)"),
  bullet("enforceTenantParam middleware on tenant-scoped routes; owner_admin bypasses for cross-clinic access"),
  bullet("MFA gate for privileged roles when mfa_enabled=true; dev bypass code 000000 only in non-production"),
  bullet("express-rate-limit on /auth/login, /auth/mfa/verify, /auth/refresh"),
  bullet("trust proxy enabled for real client IP behind Render load balancer"),
  bullet("All monetary values stored as integer cents (no floats)"),
  bullet("Defence-in-depth: middleware + service-layer tenant guards on billing and other sensitive modules"),

  h2("5. Dev Seed Accounts (password: password123)"),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ["Email", "Role", "Clinic"].map(
          (t) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })] }),
        ),
      }),
      ...[
        ["admin@clinic-a.au", "owner_admin", "Clinic A"],
        ["manager@clinic-a.au", "group_practice_manager", "Clinic A"],
        ["staff@clinic-a.au", "clinical_staff", "Clinic A"],
        ["admin@clinic-b.au", "owner_admin", "Clinic B"],
      ].map(
        (row) =>
          new TableRow({
            children: row.map((c) => new TableCell({ children: [p(c)] })),
          }),
      ),
    ],
  }),
  p(""),

  h2("6. Module Completion Status"),
  p("Note: Module numbers follow the official Build Roadmap (docs/Verve_Operational_Suite_Build_Roadmap.docx). Inventory is Module 03, NOT Module 06."),

  h3("Module 00–02: Foundation & Security — COMPLETE"),
  bullet("Monorepo scaffold, CI, ADR-001 multi-tenant architecture"),
  bullet("JWT auth, RBAC, tenant isolation, MFA scaffold, auth audit logging"),
  bullet("User management, password change/reset, PostgreSQL user persistence"),

  h3("Module 03: Inventory & Scanning — COMPLETE (MVP gap: PO submit/export)"),
  bullet("Master catalog, barcode mappings, clinic stock, adjustments"),
  bullet("Barcode parser (EAN-13, GS1, QR, Code128, Data Matrix)"),
  bullet("Scan deduct/receive with auto draft PO on reorder breach"),
  bullet("PostgreSQL persistence (catalog + inventory repos)"),
  bullet("Frontend: /inventory, /inventory/products/new, /purchase-orders (draft view only)"),
  bullet("Remaining: PO submit workflow + export (ordering completion for MVP)"),

  h3("Module 04: Rostering & Scheduling — COMPLETE"),
  bullet("Full CRUD backend with cross-clinic read access for rostered staff"),
  bullet("Shift types: standard, overtime, on_call, training"),
  bullet("Status lifecycle: scheduled → confirmed → completed; cancelled is terminal"),
  bullet("Frontend: /roster (weekly calendar grid), /my-shifts (personal view)"),
  bullet("Commission log auto-generation hook when roster status → completed"),

  h3("Module 05: Payroll, Timesheets & Leave — MOSTLY COMPLETE"),
  bullet("Schema: timesheet_entries (unified hourly + commission), leave_requests"),
  bullet("Repositories: timesheet + leave (in-memory + Postgres)"),
  bullet("Services: timesheetService, leaveService"),
  bullet("Routes mounted: /clinics/:clinicId/timesheets, /clinics/:clinicId/leave"),
  bullet("Frontend: /timesheets (clock in/out, approval queue, commission verification), /leave"),
  bullet("Key rule: commission_log entries always start as pending_verification; materials forecast uses attendance_status"),
  bullet("May need: additional API integration tests, end-to-end smoke testing, polish"),

  h3("Module 06: Clinics & Forecasting — MOSTLY COMPLETE"),
  bullet("Canonical clinics table + GET/PATCH /clinics/:clinicId"),
  bullet("Materials forecast backend: GET /forecast/materials, GET /forecast/alerts"),
  bullet("Labor forecast backend + frontend: /forecast/labor"),
  bullet("Clinic settings page: /settings/clinic"),
  bullet("Timezone-calibrated forecast windows (clinic IANA timezone)"),
  bullet("Remaining: Materials Forecast frontend UI page (backend exists, no dedicated page yet)"),

  h3("Module 07: Billing & Invoicing — SESSION 1 COMPLETE (~40% overall)"),
  bullet("Schema: invoices, invoice_line_items, payment_records, invoice_number_sequences"),
  bullet("Full billingService: draft → issue → pay → void lifecycle; GST 10% in basis points"),
  bullet("10 REST endpoints under /clinics/:clinicId/billing"),
  bullet("28 billingService unit tests"),
  bullet("Frontend: /billing (BillingLedgerPage — read/list focused)"),
  bullet("Remaining: payment gateways (Stripe/Tyro), PDF generation, email, overdue scheduler, full create/issue/void UI, Xero/MYOB sync"),

  h3("Module 08: Analytics & Audit — SESSION 1 COMPLETE (~70% overall)"),
  bullet("audit_events table + analyticsRepository"),
  bullet("6 analytics endpoints: dashboard KPIs, revenue, inventory, staff, audit list/detail"),
  bullet("Cross-module audit wiring: billing, roster, inventory mutations auto-record audit events"),
  bullet("Frontend: /analytics (dashboard), /analytics/audit (audit trail)"),
  bullet("Remaining: revenue charts polish, CSV export, cross-clinic owner roll-up reports"),

  h3("Module 09: Accounting Export — NOT STARTED"),
  bullet("Xero/MYOB/KeyPay/CSV payroll + invoice export adapters"),

  h3("Module 10–12: Mobile, Supplier, etc. — NOT STARTED"),
  bullet("Mobile-app/ is placeholder README only"),

  h3("Module 13: Database RLS + Migrations CLI — NOT STARTED"),
  bullet("PostgreSQL Row-Level Security policies"),
  bullet("Full schema migrations CLI (currently bootstrap runner in migrate.ts)"),

  h2("7. Frontend Routes & Pages (All Protected Except /login)"),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ["Route", "Page", "Access"].map(
          (t) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })] }),
        ),
      }),
      ...[
        ["/", "HomePage", "All roles"],
        ["/login", "LoginPage (+ MFA step)", "Public"],
        ["/inventory", "InventoryPage", "All roles"],
        ["/inventory/products/new", "AddProductPage", "Manager/Admin"],
        ["/purchase-orders", "PurchaseOrdersPage", "Manager/Admin"],
        ["/roster", "RosterCalendarPage", "All roles"],
        ["/my-shifts", "MyShiftsPage", "All roles"],
        ["/timesheets", "TimesheetsPage", "All roles"],
        ["/leave", "LeavePage", "All roles"],
        ["/users", "ManageUsersPage", "Manager/Admin"],
        ["/account", "AccountPage", "All roles"],
        ["/forecast/labor", "LaborForecastPage", "Manager/Admin"],
        ["/settings/clinic", "ClinicSettingsPage", "Manager/Admin (edit: owner_admin only)"],
        ["/billing", "BillingLedgerPage", "Manager/Admin"],
        ["/analytics", "AnalyticsDashboardPage", "Manager/Admin"],
        ["/analytics/audit", "AuditTrailPage", "Manager/Admin"],
      ].map(
        (row) =>
          new TableRow({
            children: row.map((c) => new TableCell({ children: [p(c)] })),
          }),
      ),
    ],
  }),
  p(""),

  h2("8. Backend API Route Mount Points (routes/index.ts)"),
  bullet("GET /health"),
  bullet("POST /auth/login, /auth/mfa/verify, /auth/refresh, /auth/logout; GET /auth/me; POST /auth/change-password"),
  bullet("/clinics/:clinicId/inventory, /scans, /products, /users, /purchase-orders, /roster"),
  bullet("/clinics/:clinicId/forecast (materials + alerts + labor)"),
  bullet("/clinics/:clinicId/timesheets, /leave"),
  bullet("/clinics/:clinicId/billing"),
  bullet("/clinics/:clinicId/analytics"),
  bullet("GET /clinics/:clinicId (clinic settings — mounted LAST to avoid route shadowing)"),

  h2("9. Key Architectural Conventions (Follow These)"),
  bullet("Use AppError for operational errors; raw Error for programmer bugs only"),
  bullet("Repository pattern: interface + in-memory + postgres implementations; switched via DATABASE_URL in dependencies.ts"),
  bullet("Integer cents for all money; GST as basis points (1000 = 10%)"),
  bullet("home_clinic_id (users/JWT) vs rostered_clinic_id (shift location) — do not conflate"),
  bullet("Commission attendance is the materials forecasting safeguard — never auto-set present"),
  bullet("Audit events are append-only; inject optional AuditWriter into services"),
  bullet("Zod .strict() on write schemas to reject unknown fields"),
  bullet("Clinic timezone forwarded to forecast services for local-day boundary calculations"),

  h2("10. Pre-Module 07 Hardening (Complete)"),
  bullet("Labor forecast costs converted to integer AUD cents internally"),
  bullet("Inventory consumption query push-down (getConsumptionVolume) — no more truncated adjustment lists"),
  bullet("Clinic ABN/timezone validation hardened; subscriptionTier removed from PATCH schema"),
  bullet("Timezone calibration for materials + labor forecast date windows"),

  h2("11. System Integration & Stabilization (Complete)"),
  bullet("Fixed health.test.ts MFA assertion (admin seed mfaEnabled: true)"),
  bullet("Wired audit events into BillingService, RosterService, InventoryService"),
  bullet("Mounted analytics routes (were imported but not mounted)"),
  bullet("Verified all 9 repositories switch Postgres/in-memory via connectedPool probe"),

  h2("12. Recent Frontend Error Fixes (June 2026)"),
  p("The following ESLint/TypeScript issues were resolved to get a clean frontend lint pass:"),
  bullet("Replaced deprecated React.FormEvent with React.SubmitEvent (or SubmitEvent import) across form handlers in:"),
  bullet2("AccountPage.tsx, BillingLedgerPage.tsx, ClinicSettingsPage.tsx, LeavePage.tsx, ManageUsersPage.tsx, RosterCalendarPage.tsx"),
  bullet("ClinicSettingsPage.tsx: fixed unused variable in destructuring when omitting subscriptionTier from PATCH payload"),
  bullet("ClinicSettingsPage.tsx: removed unnecessary type assertion (eslint --fix)"),
  p("Result: npm run lint in Frontend-Web passes with 0 errors. One remaining warning: AuthContext.tsx exports both component and context (react-refresh/only-export-components) — non-blocking."),
  p("npm run build in Frontend-Web succeeds. Backend npm test: 258/258 pass."),

  h2("13. What's Left To Do — Prioritized"),

  h3("A. MVP Go-Live Path (~2 weeks target per roadmap)"),
  bullet("PO submit + basic export — upgrade draft purchase orders to submitted + CSV/export"),
  bullet("Timesheets/leave integration smoke test across roster → commission → forecast chain"),
  bullet("End-to-end Render deployment verification"),
  bullet("Optional for MVP: Leave UI polish (backend + page already exist)"),

  h3("B. Module 06 Completion"),
  bullet("Materials Forecast frontend page — consume GET /forecast/materials and /forecast/alerts"),
  bullet("Nav link + RBAC helper (similar to Labor Forecast page pattern)"),

  h3("C. Module 07 — Billing (Sessions 2–5)"),
  bullet("Session 2: Stripe/Tyro webhook scaffolding"),
  bullet("Session 3: Invoice PDF generation + email dispatch"),
  bullet("Session 4: Overdue invoice scheduler"),
  bullet("Session 5: Xero/MYOB invoice sync + payment reconciliation"),
  bullet("Full billing CRUD UI (create draft, add line items, issue, record payment, void)"),

  h3("D. Module 08 — Analytics (Sessions 2–4)"),
  bullet("Revenue charts and richer report pages"),
  bullet("Audit event CSV export endpoint + download UI"),
  bullet("Cross-clinic aggregate reports for owner_admin"),

  h3("E. Module 09 — Accounting Export"),
  bullet("clinic_labor_rates configuration"),
  bullet("Payroll export adapters (Xero/MYOB/KeyPay/CSV)"),
  bullet("Invoice sync + payment reconciliation"),

  h3("F. Security Hardening"),
  bullet("Real TOTP MFA (authenticator app) for privileged roles"),
  bullet("httpOnly refresh token cookies (replace client-side storage)"),
  bullet("Inventory/scan tenant guard review"),

  h3("G. Module 13 — Database"),
  bullet("PostgreSQL RLS policies on all tenant tables"),
  bullet("Full migrations CLI (replace/supplement bootstrap runner)"),

  h3("H. Mobile App"),
  bullet("React Native scaffold: barcode scanning + roster viewing + offline sync"),

  h2("14. Recommended Next Step for GPT"),
  p("The codebase is past Module 06 and into Modules 07–08. Do NOT restart Inventory (Module 03) — it is built. Choose one path:"),
  bullet("Path 1 (MVP): PO submit/export → integration smoke test → Render deploy"),
  bullet("Path 2 (Feature): Module 07 Session 2 (payment gateway scaffolding)"),
  bullet("Path 3 (Feature): Module 06 gap — Materials Forecast UI"),
  p("Always run npm test (Backend) and npm run build + npm run lint (Frontend-Web) after changes. Update A_PROJECT_MEMORY.md after completing each module session."),

  h2("15. Key Reference Files"),
  bullet("A_PROJECT_MEMORY.md — detailed module-by-module build log"),
  bullet("docs/Verve_Operational_Suite_Build_Roadmap.docx — timelines and build sequence"),
  bullet("docs/adr/001-multi-tenant-architecture.md — tenant design ADR"),
  bullet("Backend/src/bootstrap/dependencies.ts — repository wiring factory"),
  bullet("Backend/src/routes/index.ts — all API mount points"),
  bullet("Frontend-Web/src/App.tsx — all frontend routes"),
  bullet("Frontend-Web/src/api/client.ts — all API client methods"),

  h2("16. Environment Variables"),
  bullet("Backend: DATABASE_URL, CORS_ORIGIN, NODE_ENV, JWT secrets, REDIS_URL (optional)"),
  bullet("Frontend: VITE_API_BASE_URL (empty for dev proxy, full URL for production)"),
  p("Without DATABASE_URL, backend uses in-memory repos — state lost on restart (fine for tests/local)."),
];

const doc = new Document({
  sections: [{ properties: {}, children }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buffer);
console.log("Written:", OUT);
