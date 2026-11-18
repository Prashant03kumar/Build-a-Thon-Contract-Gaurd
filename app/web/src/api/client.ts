// Typed fetch client for the Contract Guard API. One function per endpoint —
// every dashboard widget reads from these, no mock data anywhere.

export type Health = {
  status: "ok" | "degraded";
  service: string;
  uptimeSeconds: number;
  timestamp: string;
  database: {
    reachable: boolean;
    tables: Record<string, number> | null;
    error: string | null;
  };
  webhookReceiver: { url: string; reachable: boolean; latencyMs: number | null; error: string | null };
};

export type ProviderVersion = { fileName: string; version: string; publishOrder: number; valid: boolean };
export type Provider = { name: string; versions: ProviderVersion[] };

export type ConsumerUsage = { provider: string; method: string; path: string; sends: string[]; reads: string[] };
export type Consumer = { name: string; team: string; usages: ConsumerUsage[] };

export type FindingBase = {
  id: string;
  provider: string;
  fromVersion: string | null;
  toVersion: string | null;
  severity: string; // BREAKING | WARN | SPEC_ERROR | INFO | ...
  rule: string;
  path: string;
  message: string;
};

/** GET /api/findings — raw rows; has `notified` but no consumer list. */
export type FindingRow = FindingBase & { consumer: string | null; notified: boolean; createdAt: string };

/** GET /api/impacts — findings joined with affected consumers (no notified). */
export type ImpactFinding = FindingBase & { affectedConsumers: string[] };

/** Dashboard view = impacts + notified, merged by id on the client. */
export type FindingView = ImpactFinding & { notified: boolean };

export type GateResult = {
  decision: "ALLOWED" | "BLOCKED";
  result: "allow" | "warn" | "block";
  blocked: boolean;
  provider: string;
  publishOrder: number;
  version: string;
  affectedConsumers: string[];
  breakingFields: string[];
  explanation: string;
  warnings: { rule: string; path: string; message: string }[];
};

export type AnalyzeResult = {
  created: number;
  providers: { provider: string; versions: number; validVersions: number; pairsCompared: number; findingsCreated: number }[];
  totals: { findings: number; impacts: number };
  notifications: { attempted: number; delivered: number; failed: number };
};

export type NotifySummary = { attempted: number; delivered: number; failed: number; failures: { findingId: string; error: string }[] };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`GET ${path} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `POST ${path} → HTTP ${response.status}`);
  return data;
}

export const api = {
  health: () => get<Health>("/api/health"),
  providers: () => get<Provider[]>("/api/providers"),
  consumers: () => get<Consumer[]>("/api/consumers"),
  findings: () => get<FindingRow[]>("/api/findings"),
  impacts: () => get<{ findings: ImpactFinding[] }>("/api/impacts"),
  gateCheck: (provider: string, publishOrder: number) =>
    post<GateResult>("/api/gate-check", { provider, publishOrder }),
  analyze: () => post<AnalyzeResult>("/api/analyze"),
  retryNotifications: (resendAll = false) => post<NotifySummary>("/api/notifications/retry", { resendAll }),
  clearReceiver: () => post<{ cleared: boolean; status?: number; error?: string }>("/api/notifications/clear-receiver"),
  importKit: () => post<{ totals: { providers: number; specVersions: number; consumers: number; consumerUses: number; findings: number } }>(
    "/api/kit/import",
  ),
};

/** Merge /api/impacts (consumers) with /api/findings (notified) by finding id. */
export function mergeFindings(impacts: ImpactFinding[], rows: FindingRow[]): FindingView[] {
  const notifiedById = new Map(rows.map((r) => [r.id, r.notified]));
  return impacts.map((f) => ({ ...f, notified: notifiedById.get(f.id) ?? false }));
}
