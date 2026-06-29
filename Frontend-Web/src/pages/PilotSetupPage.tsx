import { Link, Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { canManageUsers } from "../utils/roles.js";

type SetupStep = {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
};

const SETUP_STEPS: SetupStep[] = [
  {
    title: "Organisation / Legal Entity / Clinics",
    description: "Confirm the clinic records Daniel will use for real pilot entry.",
    href: "/settings/clinics",
    actionLabel: "Open clinics",
  },
  {
    title: "Users / Staff",
    description: "Create the staff users needed for rosters, timesheets, and approvals.",
    href: "/users",
    actionLabel: "Open users",
  },
  {
    title: "Suppliers",
    description: "Enter real suppliers before purchase orders and OCR invoice review.",
    href: "/suppliers",
    actionLabel: "Open suppliers",
  },
  {
    title: "Products / Inventory",
    description: "Create real products for the selected clinic and review reorder thresholds.",
    href: "/inventory/products",
    actionLabel: "Open products",
  },
  {
    title: "Opening Stock Counts",
    description: "Record counted opening stock for each clinic product.",
    href: "/inventory/adjust?mode=opening",
    actionLabel: "Enter counts",
  },
  {
    title: "Purchase Orders",
    description: "Review low-stock generated purchase order lines after products and thresholds exist.",
    href: "/purchase-orders",
    actionLabel: "Open POs",
  },
  {
    title: "Receiving",
    description: "Receive delivered stock through the inventory scanner and adjustment history.",
    href: "/inventory?mode=receive",
    actionLabel: "Receive stock",
  },
  {
    title: "OCR Invoices",
    description: "Upload real supplier invoices from the supplier workflow and review extracted lines.",
    href: "/suppliers",
    actionLabel: "Open suppliers",
  },
  {
    title: "Roster / Timesheets",
    description: "Build pilot rosters first, then verify timesheet entry and approvals.",
    href: "/roster",
    actionLabel: "Open roster",
  },
  {
    title: "Forecasts",
    description: "Use forecasts after inventory, purchasing, and roster activity exists.",
    href: "/forecast/materials",
    actionLabel: "Open forecasts",
  },
];

export function PilotSetupPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";

  if (!user) return null;

  if (!canManageUsers(user.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <section className="status-card pilot-setup">
        <div className="status-card__header">
          <div>
            <p className="inventory-page__subtitle">Internal Beta Pilot</p>
            <h2>First-run setup guide</h2>
            <p className="inventory-page__subtitle">
              Follow this order for real clinic data entry. This guide links to existing
              operational pages and does not mark steps complete unless the app can verify
              that safely.
            </p>
          </div>
          <Link to="/" className="link-button">
            Back to Daily Hub
          </Link>
        </div>

        {isAllClinicsScope ? (
          <div className="inventory-receiving-callout" role="status">
            <h3>Select a clinic before clinic-level setup</h3>
            <p>
              Products, opening stock counts, receiving, rosters, and timesheets are recorded
              against one real clinic. Use Clinic scope in the header before entering those records.
            </p>
          </div>
        ) : null}

        <ol className="pilot-setup__steps" aria-label="Pilot setup order">
          {SETUP_STEPS.map((step, index) => (
            <li key={step.title} className="pilot-setup__step">
              <span className="pilot-setup__number">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p className="inventory-page__subtitle">{step.description}</p>
                <Link to={step.href} className="button-link">
                  {step.actionLabel}
                </Link>
              </div>
            </li>
          ))}
        </ol>

        <p className="po-summary__hint">
          Current clinic context:{" "}
          {isAllClinicsScope ? "All Clinics selected" : selectedClinic?.name ?? user.homeClinicName}.
          Use this guide as an entry order, not as a synthetic completion tracker.
        </p>
      </section>
    </AppShell>
  );
}
