import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchHealth, type Health } from "./api/client";

type Status = "loading" | "online" | "degraded" | "offline";

const STATUS_META: Record<Status, { label: string; dot: string; text: string }> = {
  loading: { label: "Checking…", dot: "bg-gray-400 animate-pulse", text: "text-gray-500" },
  online: { label: "Online", dot: "bg-emerald-500", text: "text-emerald-700" },
  degraded: { label: "Degraded — webhook receiver unreachable", dot: "bg-amber-500", text: "text-amber-700" },
  offline: { label: "Offline", dot: "bg-red-500", text: "text-red-700" },
};

function statusOf(health: Health | null, failed: boolean): Status {
  if (failed) return "offline";
  if (health === null) return "loading";
  return health.status === "ok" ? "online" : "degraded";
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const h = await fetchHealth();
      if (!alive) return;
      setFailed(h === null);
      setHealth(h);
    };
    load();
    const timer = setInterval(load, 5000); // poll, same rhythm as the receiver's own page
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const status = statusOf(health, failed);
  const meta = STATUS_META[status];
  const receiver = health?.webhookReceiver;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
            CG
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Contract Guard</h1>
            <p className="text-xs text-gray-500">API contract registry — scaffold preview (M0)</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm font-medium">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          <span className={meta.text}>{meta.label}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card title="API server">
            <p className="text-2xl font-semibold">{health?.service ?? "—"}</p>
            <p className="mt-1 text-sm text-gray-500">
              Uptime: {health ? `${health.uptimeSeconds}s` : "—"}
            </p>
          </Card>

          <Card title="Webhook receiver">
            <p className={`text-2xl font-semibold ${receiver?.reachable ? "text-emerald-600" : "text-red-600"}`}>
              {receiver ? (receiver.reachable ? `Reachable · ${receiver.latencyMs ?? "?"} ms` : "Unreachable") : "—"}
            </p>
            <p className="mt-1 truncate text-sm text-gray-500">{receiver?.url ?? "—"}</p>
            {receiver?.error && <p className="mt-1 text-xs text-red-500">{receiver.error}</p>}
          </Card>

          <Card title="Runtime">
            <p className="text-sm text-gray-600">React + Vite + Tailwind</p>
            <p className="text-sm text-gray-600">Express API on :3001</p>
            <p className="mt-1 text-xs text-gray-400">Last check: {health?.timestamp ?? "—"}</p>
          </Card>
        </div>

        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Coming next (see PLAN.md)</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
            <li>M1 — Ingest &amp; store: kit import, upload API, Prisma/SQLite, spec lint (dangling $ref, republish)</li>
            <li>M2 — Diff engine: version comparison &amp; breaking-change rules</li>
            <li>M3 — Consumer impact mapping &amp; publish gate</li>
            <li>M4 — Webhook notifications · M5 — Dashboard screens</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
