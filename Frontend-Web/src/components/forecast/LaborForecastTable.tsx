/**
 * LaborForecastTable — legacy/compat shim.
 *
 * The primary shift-type breakdown table is now rendered inline in LaborForecastPage.tsx.
 * This component is kept to avoid breaking any tests/imports that reference it.
 */
import type { ShiftTypeProjection } from "../../types/forecast.js";

type Props = {
  rows: ShiftTypeProjection[];
};

function formatAud(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function LaborForecastTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="lf-table-empty">
        <p className="lf-table-empty__title">No scheduled shifts in this window.</p>
        <p className="lf-table-empty__hint">Adjust the date range or check the roster.</p>
      </div>
    );
  }

  return (
    <div className="lf-table-wrapper">
      <table className="lf-table">
        <thead>
          <tr>
            <th className="lf-table__th">Shift type</th>
            <th className="lf-table__th lf-table__th--numeric">Projected hrs</th>
            <th className="lf-table__th lf-table__th--numeric">Base cost</th>
            <th className="lf-table__th lf-table__th--numeric">Super</th>
            <th className="lf-table__th lf-table__th--numeric">Total cost</th>
            <th className="lf-table__th">Rate source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.shiftType} className="lf-table__row">
              <td className="lf-table__cell">
                <span className={`lf-role-badge lf-role-badge--${row.shiftType}`}>
                  {row.shiftType.replace("_", "-")}
                </span>
              </td>
              <td className="lf-table__numeric">{row.projectedHours.toFixed(2)}</td>
              <td className="lf-table__numeric">{formatAud(row.baseCost)}</td>
              <td className="lf-table__numeric">{formatAud(row.superCost)}</td>
              <td className="lf-table__numeric lf-table__numeric--total">{formatAud(row.totalCost)}</td>
              <td>
                {row.usingFallbackForSomeStaff ? (
                  <span className="inventory-badge" title="Using default estimate">Default estimate</span>
                ) : (
                  <span className="inventory-badge" title="Configured pay rates">Configured</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
