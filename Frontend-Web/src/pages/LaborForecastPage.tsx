import { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { LaborForecastSummaryCard } from "../components/forecast/LaborForecastSummaryCard.js";
import { LaborForecastTable } from "../components/forecast/LaborForecastTable.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useLaborForecast } from "../hooks/useLaborForecast.js";
import { canViewLaborForecast } from "../utils/roles.js";

const MIN_DAYS = 1;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 14;

export function LaborForecastPage() {
  const { user } = useAuth();
  const [forecastDays, setForecastDays] = useState(DEFAULT_DAYS);
  const [inputValue, setInputValue] = useState(String(DEFAULT_DAYS));

  const clinicId = user?.homeClinicId;
  const { data, isLoading, error, refetch } = useLaborForecast(clinicId, forecastDays);

  if (!user) return null;

  if (!canViewLaborForecast(user.role)) {
    return <Navigate to="/" replace />;
  }

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10);
    setForecastDays(val);
    setInputValue(String(val));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
  }

  function handleInputBlur() {
    const parsed = parseInt(inputValue, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.min(MAX_DAYS, Math.max(MIN_DAYS, parsed));
      setForecastDays(clamped);
      setInputValue(String(clamped));
    } else {
      setInputValue(String(forecastDays));
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Labor Cost Forecast</h2>
            <p className="inventory-page__subtitle">
              {user.homeClinicName} — projected labor costs for upcoming scheduled shifts
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

        <div className="lf-controls">
          <label className="lf-controls__label" htmlFor="forecast-days-slider">
            Forecast window
          </label>
          <div className="lf-controls__inputs">
            <input
              id="forecast-days-slider"
              type="range"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={forecastDays}
              onChange={handleSliderChange}
              className="lf-controls__slider"
            />
            <div className="lf-controls__number-wrap">
              <input
                type="number"
                min={MIN_DAYS}
                max={MAX_DAYS}
                value={inputValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown}
                className="lf-controls__number"
                aria-label="Forecast days"
              />
              <span className="lf-controls__unit">days</span>
            </div>
          </div>
          <p className="lf-controls__hint">
            Showing projected costs for the next {forecastDays}{" "}
            {forecastDays === 1 ? "day" : "days"} (1–90 day range)
          </p>
        </div>

        {error ? (
          <p className="status-card__error">{error}</p>
        ) : isLoading ? (
          <p className="loading-message">Calculating labor forecast…</p>
        ) : data ? (
          <>
            <LaborForecastSummaryCard summary={data} />
            <div className="lf-section">
              <h3 className="lf-section__heading">Breakdown by Role</h3>
              <p className="lf-section__sub">
                Role proxy is shift type. A dedicated clinical role column (dentist,
                dental nurse, etc.) will replace this in Module 09.
              </p>
              <LaborForecastTable rows={data.breakdownByRole} />
            </div>
          </>
        ) : null}
      </section>

      <section className="status-card lf-disclaimer">
        <h3 className="lf-disclaimer__heading">Projection methodology</h3>
        <ul className="lf-disclaimer__list">
          <li>
            Hours are calibrated against approved timesheets from the past 30 days.
            Staff with no history fall back to scheduled shift duration.
          </li>
          <li>
            Rates use FY2026 Australian Dental Industry Award defaults.
            Clinic-specific rates will be configurable in Module 09.
          </li>
          <li>
            Overhead (~15%) covers the 11% superannuation guarantee, payroll tax,
            and WorkCover insurance.
          </li>
          <li>Cancelled shifts are excluded. Commission-log entries are not counted.</li>
        </ul>
      </section>
    </AppShell>
  );
}
