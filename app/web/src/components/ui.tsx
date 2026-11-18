// Small shared UI pieces for the dashboard — Tailwind classes matching the M0
// style (white cards on gray-50, rounded-xl, shadow-sm) and the severity color
// language from PLAN.md §9.
import type { ReactNode } from "react";

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>}
      {children}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: number | string; hint?: string; tone?: "default" | "danger" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</h2>
      <p className={`mt-1 text-3xl font-semibold ${tone === "danger" && Number(value) > 0 ? "text-red-600" : "text-gray-900"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  BREAKING: "bg-red-100 text-red-700 border-red-200",
  WARN: "bg-amber-100 text-amber-700 border-amber-200",
  DEPRECATION: "bg-amber-100 text-amber-700 border-amber-200",
  SUNSET_EXPIRED: "bg-amber-100 text-amber-700 border-amber-200",
  EARLY_REMOVAL: "bg-violet-100 text-violet-700 border-violet-200",
  SPEC_ERROR: "bg-blue-100 text-blue-700 border-blue-200",
  INFO: "bg-gray-100 text-gray-600 border-gray-200",
};

export function SeverityChip({ severity }: { severity: string }) {
  const style = SEVERITY_STYLE[severity] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${style}`}>{severity}</span>;
}

export function GateBadge({ decision }: { decision: "ALLOWED" | "BLOCKED" | "INVALID" | "…" }) {
  if (decision === "…") {
    return <span className="inline-block rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-400">…</span>;
  }
  if (decision === "INVALID") {
    return <span className="inline-block rounded border border-blue-200 bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">INVALID SPEC</span>;
  }
  const style =
    decision === "BLOCKED" ? "border-red-200 bg-red-100 text-red-700" : "border-emerald-200 bg-emerald-100 text-emerald-700";
  return <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${style}`}>{decision}</span>;
}

export function ValidBadge({ valid }: { valid: boolean }) {
  return valid ? (
    <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">valid</span>
  ) : (
    <span className="inline-block rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">invalid</span>
  );
}

export function ConsumerChip({ name }: { name: string }) {
  return <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">{name}</span>;
}

export function NotifyDot({ notified }: { notified: boolean }) {
  return notified ? (
    <span title="Delivered to webhook receiver" className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
  ) : (
    <span title="Pending webhook delivery" className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
  );
}
