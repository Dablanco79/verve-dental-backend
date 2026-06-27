import { useState } from "react";
import { Navigate, Link } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { MaterialsForecastAlerts } from "../components/forecast/MaterialsForecastAlerts.js";
import { MaterialsForecastCharts } from "../components/forecast/MaterialsForecastCharts.js";
import { MaterialsForecastSummaryCards } from "../components/forecast/MaterialsForecastSummaryCards.js";
import { MaterialsForecastTable } from "../components/forecast/MaterialsForecastTable.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useMaterialsForecast } from "../hooks/useMaterialsForecast.js";
import { canViewMaterialsForecast } from "../utils/roles.js";

// ── Horizon options ────────────────────────────────────────────────────────────

const HORIZON_OPTIONS = [7, 14, 30, 60, 90] as const;
type HorizonDays = (typeof HORIZON_OPTIONS)[number];
const DEFAULT_HORIZON: HorizonDays = 30;

// ── Component ─────────────────────────────────────────────────────────────────

export function MaterialsForecastPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const [forecastDays, setForecastDays] = useState<HorizonDays>(DEFAULT_HORIZON);

  // Guard before passing clinicId to the hook — prevents API calls for
  // clinical_staff who will be redirected before seeing any data.
  const hasAccess = user !== null && canViewMaterialsForecast(user.role);
  const clinicId = hasAccess && !isAllClinicsScope ? selectedClinicId : undefined;

  const { projections, alerts, summary, isLoading, error, refetch } = useMaterialsForecast(
    clinicId,
    forecastDays,
  );

  if (!user) return null;

  if (!canViewMaterialsForecast(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to view materials forecast</h2>
          <p>
            Materials forecasts depend on clinic inventory and roster demand.
            Choose a real clinic from Clinic scope before reviewing reorder planning.
          </p>
        </section>
      </AppShell>
    );
  }

  const hasAlerts = alerts !== null && alerts.length > 0;
  const reorderItems = projections?.filter((p) => p.willBreachSafetyThreshold) ?? [];
  const hasPurchaseOrderSuggestions = reorderItems.length > 0;

  return (
    <AppShell>

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Materials Forecast</h2>
            <p className="inventory-page__subtitle">
              {(selectedClinic?.name ?? user.homeClinicName)} — projected supply consumption and reorder planning
            </p>
          </div>
          <div className="inventory-page__actions">
            <button
              type="button"
              className="button-link"
              onClick={refetch}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* ── Forecast Horizon Selector ────────────────────────────────────── */}
        <div className="mf-horizon">
          <span className="mf-horizon__label">Forecast window</span>
          <div className="mf-horizon__buttons" role="group" aria-label="Forecast horizon">
            {HORIZON_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={`mf-horizon__btn${forecastDays === days ? " mf-horizon__btn--active" : ""}`}
                onClick={() => { setForecastDays(days); }}
                aria-pressed={forecastDays === days}
              >
                {days} days
              </button>
            ))}
          </div>
          <p className="mf-horizon__hint">
            Projecting demand for the next {forecastDays} days based on scheduled shifts and
            historical consumption
          </p>
        </div>

        {/* ── Loading / Error / Content states ────────────────────────────── */}
        {error ? (
          <div className="status-card__error">
            <p>{error}</p>
            <button type="button" className="button-link" onClick={refetch}>
              Try again
            </button>
          </div>
        ) : isLoading ? (
          <p className="loading-message">Calculating materials forecast…</p>
        ) : summary && projections && alerts ? (
          <>
            {/* ── Summary KPI Cards ────────────────────────────────────────── */}
            <MaterialsForecastSummaryCards summary={summary} forecastDays={forecastDays} />

            {/* ── Charts ──────────────────────────────────────────────────── */}
            {projections.length > 0 ? (
              <div className="mf-section">
                <h3 className="mf-section__heading">Inventory Risk Overview</h3>
                <MaterialsForecastCharts
                  projections={projections}
                  forecastDays={forecastDays}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {/* ── Stock Alerts ────────────────────────────────────────────────────── */}
      {!isLoading && alerts !== null ? (
        <section className="status-card">
          <div className="status-card__header">
            <div>
              <h3>
                Stock Alerts
                {hasAlerts ? (
                  <span className="mf-section-badge mf-section-badge--alert">
                    {alerts.length}
                  </span>
                ) : null}
              </h3>
              <p className="inventory-page__subtitle">
                Products projected to run below their safety reorder level
              </p>
            </div>
          </div>
          <MaterialsForecastAlerts alerts={alerts} />
        </section>
      ) : null}

      {/* ── Forecast Table ─────────────────────────────────────────────────── */}
      {!isLoading && projections !== null ? (
        <section className="status-card">
          <div className="status-card__header">
            <div>
              <h3>Product Demand Projections</h3>
              <p className="inventory-page__subtitle">
                Full {forecastDays}-day demand forecast for all clinic inventory products
              </p>
            </div>
          </div>
          <MaterialsForecastTable rows={projections} />
        </section>
      ) : null}

      {/* ── Reorder Workflow ────────────────────────────────────────────────── */}
      {!isLoading && hasPurchaseOrderSuggestions ? (
        <section className="status-card mf-reorder-section">
          <div className="status-card__header">
            <div>
              <h3>Reorder Planning</h3>
              <p className="inventory-page__subtitle">
                {reorderItems.length}{" "}
                {reorderItems.length === 1 ? "product requires" : "products require"} restocking
                within the forecast window
              </p>
            </div>
          </div>

          <div className="mf-reorder-actions">
            <div className="mf-reorder-actions__primary">
              <Link to="/purchase-orders" className="mf-reorder-btn mf-reorder-btn--primary">
                Review Purchase Orders
              </Link>
              <p className="mf-reorder-actions__hint">
                Use the purchase orders module to raise supplier orders for the products listed
                above.
              </p>
            </div>

            {reorderItems.some((p) => p.supplierName !== null) ? (
              <div className="mf-reorder-supplier-summary">
                <h4 className="mf-reorder-supplier-summary__heading">Supplier Information</h4>
                <div className="mf-reorder-items">
                  {reorderItems.map((item) => (
                    <div key={item.masterCatalogItemId} className="mf-reorder-item">
                      <div className="mf-reorder-item__name">
                        <span className="mf-reorder-item__product">{item.name}</span>
                        <span className="mf-reorder-item__sku">{item.sku}</span>
                      </div>
                      <div className="mf-reorder-item__details">
                        <span className="mf-reorder-item__qty">
                          Reorder: {item.recommendedReorderQty} {item.unitOfMeasure}
                        </span>
                        {item.estimatedReorderCostCents !== null ? (
                          <span className="mf-reorder-item__cost">
                            Est.{" "}
                            {new Intl.NumberFormat("en-AU", {
                              style: "currency",
                              currency: "AUD",
                            }).format(item.estimatedReorderCostCents / 100)}
                          </span>
                        ) : null}
                        {item.supplierName !== null ? (
                          <span className="mf-reorder-item__supplier">
                            Supplier: {item.supplierName}
                          </span>
                        ) : (
                          <span className="mf-reorder-item__no-supplier">
                            No preferred supplier
                          </span>
                        )}
                        {item.effectiveUnitCostCents !== null ? (
                          <span className="mf-reorder-item__unit-cost">
                            Unit cost:{" "}
                            {new Intl.NumberFormat("en-AU", {
                              style: "currency",
                              currency: "AUD",
                            }).format(item.effectiveUnitCostCents / 100)}
                          </span>
                        ) : (
                          <span className="mf-reorder-item__no-price">
                            Pricing unavailable
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Methodology Disclaimer ─────────────────────────────────────────── */}
      <section className="status-card mf-disclaimer">
        <h3 className="mf-disclaimer__heading">How this forecast is calculated</h3>
        <ul className="mf-disclaimer__list">
          <li>
            Projected usage is based on historical scan-deduct consumption per verified
            shift, multiplied by upcoming scheduled shifts in the forecast window.
          </li>
          <li>
            Only manager-approved attendance records are used in the consumption rate
            calculation — unverified timesheets are excluded.
          </li>
          <li>
            Cancelled shifts are not counted. New clinics or products with no scan history
            will show zero projected usage.
          </li>
          <li>
            Reorder costs are estimates only, based on current unit costs in the clinic
            inventory catalogue.
          </li>
        </ul>
      </section>

    </AppShell>
  );
}
