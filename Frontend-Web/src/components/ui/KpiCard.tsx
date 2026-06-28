import type { ReactNode } from "react";

type KpiCardStatus = "neutral" | "positive" | "warning" | "danger" | "info" | "purple" | "teal";

type KpiCardProps = {
  icon?: ReactNode;
  title: string;
  value: ReactNode;
  secondaryText?: ReactNode;
  status?: KpiCardStatus;
  trend?: ReactNode;
  className?: string;
};

export function KpiCard({
  icon,
  title,
  value,
  secondaryText,
  status = "neutral",
  trend,
  className,
}: KpiCardProps) {
  const classNames = ["vds-kpi-card", `vds-kpi-card--${status}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classNames}>
      <div className="vds-kpi-card__header">
        {icon ? (
          <span className="vds-kpi-card__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <h3 className="vds-kpi-card__title">{title}</h3>
      </div>
      <div className="vds-kpi-card__body">
        <p className="vds-kpi-card__value">{value}</p>
        {trend ? <span className="vds-kpi-card__trend">{trend}</span> : null}
      </div>
      {secondaryText ? <p className="vds-kpi-card__secondary">{secondaryText}</p> : null}
    </section>
  );
}
