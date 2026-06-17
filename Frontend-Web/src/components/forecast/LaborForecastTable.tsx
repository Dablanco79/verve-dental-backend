import { useState } from "react";

import type { RoleLaborProjection } from "../../types/forecast.js";

type SortKey = keyof Omit<RoleLaborProjection, "role"> | "role";
type SortDir = "asc" | "desc";

type Props = {
  rows: RoleLaborProjection[];
};

const ROLE_LABELS: Record<string, string> = {
  standard: "Standard",
  overtime: "Overtime",
  on_call: "On-Call",
  training: "Training",
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function formatAud(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function sortRows(
  rows: RoleLaborProjection[],
  key: SortKey,
  dir: SortDir,
): RoleLaborProjection[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") {
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    return 0;
  });
}

type HeaderProps = {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
};

function SortableHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  numeric,
}: HeaderProps) {
  const isActive = currentKey === sortKey;
  const indicator = isActive ? (currentDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <th
      className={`lf-table__th${numeric ? " lf-table__th--numeric" : ""}${isActive ? " lf-table__th--active" : ""}`}
      onClick={() => { onSort(sortKey); }}
      role="columnheader"
      aria-sort={isActive ? (currentDir === "asc" ? "ascending" : "descending") : "none"}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label}{indicator}
    </th>
  );
}

export function LaborForecastTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("role");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="lf-table-empty">
        <p className="lf-table-empty__title">No scheduled shifts in this window.</p>
        <p className="lf-table-empty__hint">
          Adjust the forecast window or check the roster for upcoming shifts.
        </p>
      </div>
    );
  }

  const sorted = sortRows(rows, sortKey, sortDir);

  return (
    <div className="lf-table-wrapper">
      <table className="lf-table">
        <thead>
          <tr>
            <SortableHeader
              label="Role"
              sortKey="role"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
            />
            <SortableHeader
              label="Projected Hours"
              sortKey="totalScheduledHours"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              numeric
            />
            <SortableHeader
              label="Base Cost (AUD)"
              sortKey="projectedBaseCost"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              numeric
            />
            <SortableHeader
              label="Overhead Cost (AUD)"
              sortKey="projectedOverheadCost"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              numeric
            />
            <SortableHeader
              label="Total Cost (AUD)"
              sortKey="totalProjectedCost"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              numeric
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.role} className="lf-table__row">
              <td className="lf-table__role">
                <span className={`lf-role-badge lf-role-badge--${row.role}`}>
                  {formatRole(row.role)}
                </span>
              </td>
              <td className="lf-table__numeric">{row.totalScheduledHours.toFixed(2)}</td>
              <td className="lf-table__numeric">{formatAud(row.projectedBaseCost)}</td>
              <td className="lf-table__numeric">{formatAud(row.projectedOverheadCost)}</td>
              <td className="lf-table__numeric lf-table__numeric--total">
                {formatAud(row.totalProjectedCost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
