import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  mergeFindings,
  type Consumer,
  type FindingView,
  type GateResult,
  type Health,
  type Provider,
} from "./api/client";
import { Card, ConsumerChip, GateBadge, NotifyDot, SeverityChip, StatCard, ValidBadge } from "./components/ui";

// Gate results are keyed per provider + publish slot; invalid specs are never
// checked against the gate (they cannot be published) and show INVALID instead.
type GateState = "unchecked" | "error" | GateResult;
const gateKey = (provider: string, publishOrder: number) => `${provider}:${publishOrder}`;

const SEVERITY_ORDER: Record<string, number> = { BREAKING: 0, SPEC_ERROR: 1, WARN: 2, DEPRECATION: 3, SUNSET_EXPIRED: 3, EARLY_REMOVAL: 3, INFO: 4 };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [findings, setFindings] = useState<FindingView[]>([]);
  const [gates, setGates] = useState<Record<string, GateState>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadData = useCallback(async () => {
    // 1) everything except gates, in parallel
    const [providersData, consumersData, impactsData, findingsRows] = await Promise.all([
      api.providers(),
      api.consumers(),
      api.impacts(),
      api.findings(),
    ]);
    setProviders(providersData);
    setConsumers(consumersData);
    setFindings(
      mergeFindings(impactsData.findings, findingsRows).sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.provider.localeCompare(b.provider),
      ),
    );

    // 2) gate verdicts for every publishable (valid) version — real decisions
    const checks: { key: string; promise: Promise<GateResult> }[] = [];
    for (const provider of providersData) {
      for (const version of provider.versions) {
        if (!version.valid) continue; // invalid spec cannot be published
        checks.push({
          key: gateKey(provider.name, version.publishOrder),
          promise: api.gateCheck(provider.name, version.publishOrder),
        });
      }
    }
    const results = await Promise.allSettled(checks.map((c) => c.promise));
    const nextGates: Record<string, GateState> = {};
    checks.forEach((check, i) => {
      const outcome = results[i];
      nextGates[check.key] = outcome.status === "fulfilled" ? outcome.value : "error";
    });
    // invalid versions get the INVALID badge without a network call
    for (const provider of providersData) {
      for (const version of provider.versions) {
        if (!version.valid) nextGates[gateKey(provider.name, version.publishOrder)] = "error";
      }
    }
    setGates(nextGates);
    setLoaded(true);
  }, []);

  // one initial load + light health polling (same rhythm as the receiver page)
  useEffect(() => {
    loadData().catch(() => setLoaded(true));
    const timer = setInterval(() => api.health().then(setHealth).catch(() => setHealth(null)), 5000);
    return () => clearInterval(timer);
  }, [loadData]);

  const runAction = useCallback(
    async (name: string, action: () => Promise<string>) => {
      setBusy(name);
      setActionMsg(null);
      try {
        const text = await action();
        await loadData();
        setActionMsg({ ok: true, text });
      } catch (err) {
        setActionMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(null);
      }
    },
    [loadData],
  );

  // ---- derived stats (all from real API data) ----
  const versionCount = useMemo(() => providers.reduce((sum, p) => sum + p.versions.length, 0), [providers]);
  const breaking = useMemo(() => findings.filter((f) => f.severity === "BREAKING"), [findings]);
  const delivered = useMemo(() => findings.filter((f) => f.notified).length, [findings]);
  const pendingNotify = useMemo(() => breaking.filter((f) => !f.notified).length, [breaking]);

  const latestGates = useMemo(
    () =>
      providers.map((provider) => {
        const valid = provider.versions.filter((v) => v.valid);
        const latest = valid[valid.length - 1];
        const gate = latest ? gates[gateKey(provider.name, latest.publishOrder)] : "error";
        return { provider, latest, gate };
      }),
    [providers, gates],
  );

  const findingsForVersion = useCallback(
    (provider: string, version: string) => findings.filter((f) => f.provider === provider && f.toVersion === version).length,
    [findings],
  );
  const findingsForConsumer = useCallback(
    (consumer: string) => findings.filter((f) => f.affectedConsumers.includes(consumer)).length,
    [findings],
  );

  const gateOf = (provider: string, publishOrder: number, valid: boolean): "ALLOWED" | "BLOCKED" | "INVALID" | "…" => {
    if (!valid) return "INVALID"; // spec cannot be published — definite state
    const gate = gates[gateKey(provider, publishOrder)];
    if (gate === "error" || gate === "unchecked" || gate === undefined) return "…"; // verdict unknown, NOT invalid
    return gate.decision;
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* ---- header ---- */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">CG</span>
          <div className="mr-auto">
            <h1 className="text-lg font-semibold leading-tight">Contract Guard</h1>
            <p className="text-xs text-gray-500">API contract registry — dashboard</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${health ? (health.status === "ok" ? "bg-emerald-500" : "bg-amber-500") : "bg-gray-300"}`} />
            <span className={health?.status === "ok" ? "text-emerald-700" : "text-amber-700"}>
              {health ? (health.status === "ok" ? "All systems ok" : "Degraded — check DB / receiver") : "Checking…"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {/* ---- actions ---- */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => runAction("import", async () => {
              const r = await api.importKit();
              return `Imported: ${r.totals.specVersions} spec versions, ${r.totals.consumerUses} consumer usages, ${r.totals.findings} lint findings.`;
            })}
            disabled={busy !== null}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "import" ? "Importing…" : "Import kit"}
          </button>
          <button
            onClick={() => runAction("analyze", async () => {
              const r = await api.analyze();
              return `Analyzed: ${r.created} new findings, ${r.totals.impacts} consumer impacts, notifications ${r.notifications.delivered} delivered / ${r.notifications.failed} failed.`;
            })}
            disabled={busy !== null}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "analyze" ? "Analyzing…" : "Run analyze"}
          </button>
          <button
            onClick={() => runAction("notify", async () => {
              const r = await api.retryNotifications(true); // resend all BREAKING (already-notified included)
              return `Notifications: ${r.delivered} delivered, ${r.failed} failed of ${r.attempted} attempted.`;
            })}
            disabled={busy !== null}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "notify" ? "Resending…" : "Resend notifications"}
          </button>
          {actionMsg && (
            <span className={`text-sm ${actionMsg.ok ? "text-emerald-700" : "text-red-600"}`}>{actionMsg.text}</span>
          )}
        </div>

        {/* ---- overview cards ---- */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Providers" value={loaded ? providers.length : "—"} hint="quote · policy · claims" />
          <StatCard label="Spec versions" value={loaded ? versionCount : "—"} hint="ordered by publishOrder" />
          <StatCard label="Consumers" value={loaded ? consumers.length : "—"} hint="registered services" />
          <StatCard label="Breaking changes" value={loaded ? breaking.length : "—"} tone="danger" hint="detected by the diff engine" />
        </div>

        {/* ---- publishing gate ---- */}
        <Card title="Publishing gate — latest version of each provider">
          <div className="grid gap-4 md:grid-cols-3">
            {latestGates.map(({ provider, latest, gate }) => {
              const known = gate !== "error" && gate !== "unchecked" && latest !== undefined;
              const decision: "ALLOWED" | "BLOCKED" | "INVALID" | "…" = !latest
                ? "…"
                : known
                  ? gate.decision
                  : "…"; // verdict unknown (check failed / still loading) — never shown as INVALID
              const explanation = known ? gate.explanation : latest ? "Gate verdict could not be loaded — retry Run analyze." : "No valid latest version to check.";
              const affected = known ? gate.affectedConsumers : [];
              return (
                <div key={provider.name} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{provider.name}</span>
                    <GateBadge decision={decision} />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    v{latest ? `${latest.version} (publishOrder ${latest.publishOrder})` : "—"}
                  </p>
                  <p className="mt-2 text-xs text-gray-600">{explanation}</p>
                  {affected.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {affected.map((name) => <ConsumerChip key={name} name={name} />)}
                    </div>
                  )}
                </div>
              );
            })}
            {providers.length === 0 && <p className="text-sm text-gray-500">No providers yet — run “Import kit”.</p>}
          </div>
        </Card>

        {/* ---- providers & versions ---- */}
        <Card title="Providers & versions (gate verdict per publish slot)">
          <div className="space-y-5">
            {providers.map((provider) => (
              <div key={provider.name}>
                <h3 className="mb-2 font-medium">{provider.name}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                        <th className="py-1.5 pr-3 font-medium">#</th>
                        <th className="py-1.5 pr-3 font-medium">Version</th>
                        <th className="py-1.5 pr-3 font-medium">File</th>
                        <th className="py-1.5 pr-3 font-medium">Spec</th>
                        <th className="py-1.5 pr-3 font-medium">Gate</th>
                        <th className="py-1.5 font-medium">Findings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {provider.versions.map((version) => (
                        <tr key={version.publishOrder} className="border-b border-gray-50">
                          <td className="py-1.5 pr-3 text-gray-500">{version.publishOrder}</td>
                          <td className="py-1.5 pr-3 font-medium">{version.version}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs text-gray-500">{version.fileName}</td>
                          <td className="py-1.5 pr-3"><ValidBadge valid={version.valid} /></td>
                          <td className="py-1.5 pr-3"><GateBadge decision={gateOf(provider.name, version.publishOrder, version.valid)} /></td>
                          <td className="py-1.5">{findingsForVersion(provider.name, version.version)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ---- findings ---- */}
        <Card title={`Findings (${findings.length}) — version comparison results`}>
          {findings.length === 0 ? (
            <p className="text-sm text-gray-500">No findings yet — run “Import kit” then “Run analyze”.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {findings.map((finding) => (
                <li key={finding.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
                  <NotifyDot notified={finding.notified} />
                  <SeverityChip severity={finding.severity} />
                  <span className="text-xs text-gray-400">{finding.provider} · {finding.fromVersion ?? "—"} → {finding.toVersion ?? "—"}</span>
                  <span className="font-mono text-xs text-gray-700">{finding.path}</span>
                  <span className="w-full text-sm text-gray-600">{finding.message}</span>
                  {finding.affectedConsumers.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-400">affects</span>
                      {finding.affectedConsumers.map((name) => <ConsumerChip key={name} name={name} />)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-400">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" /> delivered to webhook receiver
            · <span className="mx-1 inline-block h-2 w-2 rounded-full bg-amber-400 align-middle" /> pending delivery (BREAKING only)
          </p>
        </Card>

        {/* ---- consumers + webhook status ---- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={`Consumers (${consumers.length})`} className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {consumers.map((consumer) => (
                <div key={consumer.name} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{consumer.name}</span>
                    <span className="text-xs text-gray-400">{consumer.team}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {consumer.usages.length} call{consumer.usages.length === 1 ? "" : "s"} ·{" "}
                    {[...new Set(consumer.usages.map((u) => u.provider))].join(", ")}
                  </p>
                  {findingsForConsumer(consumer.name) > 0 && (
                    <p className="mt-1 text-xs font-medium text-red-600">
                      affected by {findingsForConsumer(consumer.name)} finding{findingsForConsumer(consumer.name) === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Webhook notifications">
            <p className="text-sm text-gray-600">
              Receiver:{" "}
              {health ? (
                health.webhookReceiver.reachable ? (
                  <span className="font-medium text-emerald-700">reachable ({health.webhookReceiver.latencyMs ?? "?"} ms)</span>
                ) : (
                  <span className="font-medium text-red-600">unreachable</span>
                )
              ) : (
                "…"
              )}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Delivered: <span className="font-semibold">{delivered}</span> finding{delivered === 1 ? "" : "s"}
            </p>
            <p className="text-sm text-gray-600">
              Pending (BREAKING): <span className={`font-semibold ${pendingNotify > 0 ? "text-amber-600" : ""}`}>{pendingNotify}</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={health?.webhookReceiver.url ?? "http://localhost:9900"}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Open receiver live page ↗
              </a>
              <button
                onClick={() => runAction("clear", async () => {
                  const r = await api.clearReceiver();
                  if (!r.cleared) throw new Error(r.error ?? `receiver returned HTTP ${r.status}`);
                  return "Receiver cleared — ready for a fresh demo run.";
                })}
                disabled={busy !== null}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-50"
              >
                {busy === "clear" ? "Clearing…" : "Clear receiver"}
              </button>
            </div>
          </Card>
        </div>

        <p className="text-center text-xs text-gray-400">Last refresh {health?.timestamp ?? "—"} · data: real, from the Contract Guard API</p>
      </main>
    </div>
  );
}
