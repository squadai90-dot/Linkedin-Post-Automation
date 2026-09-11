import type { ReactNode } from "react";

export function SectionHeader({
  kicker,
  title,
  description,
  action,
}: {
  kicker: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="section-header">
      <div>
        <span className="section-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </header>
  );
}

export function MetricCard({
  value,
  label,
  detail,
  tone = "neutral",
}: {
  value: string;
  label: string;
  detail: string;
  tone?: "neutral" | "good" | "review" | "indigo";
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll(" ", "-");
  return <span className={`status-pill status-${normalized}`}>{status}</span>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress-wrap" aria-label={label ?? `${value}% complete`}>
      <div className="progress-meta"><span>{label ?? "Progress"}</span><strong>{value}%</strong></div>
      <div className="progress-track"><span style={{ width: `${value}%` }} /></div>
    </div>
  );
}

export function SourceBadge({ children }: { children: ReactNode }) {
  return <span className="source-badge">↗ {children}</span>;
}

export function InfoPair({ label, value }: { label: string; value: ReactNode }) {
  return <div className="info-pair"><span>{label}</span><strong>{value}</strong></div>;
}

export function Callout({
  title,
  children,
  tone = "indigo",
}: {
  title: string;
  children: ReactNode;
  tone?: "indigo" | "teal" | "amber" | "red";
}) {
  return <aside className={`callout callout-${tone}`}><strong>{title}</strong><div>{children}</div></aside>;
}
