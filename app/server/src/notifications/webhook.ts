import { prisma } from "../db";
import { findingOperation } from "../engine/impact";

const inFlight = new Set<string>();

export type NotificationSummary = {
  attempted: number;
  delivered: number;
  failed: number;
  failures: { findingId: string; error: string }[];
};

export type NotificationOptions = {
  webhookBase?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  provider?: string;
  /** Re-deliver every BREAKING finding even if already notified (demo reset after clearing the receiver). */
  resendAll?: boolean;
};

export async function sendPendingBreakingNotifications(
  options: NotificationOptions = {},
): Promise<NotificationSummary> {
  const findings = await prisma.finding.findMany({
    where: {
      severity: "BREAKING",
      ...(options.resendAll ? {} : { notified: false }),
      ...(options.provider ? { provider: options.provider } : {}),
    },
    include: { impacts: { include: { consumer: true } } },
    orderBy: [{ provider: "asc" }, { toVersion: "asc" }, { id: "asc" }],
  });

  const summary: NotificationSummary = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    failures: [],
  };
  const webhookBase = (
    options.webhookBase ??
    process.env.WEBHOOK_BASE ??
    "http://localhost:9900"
  ).replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;

  for (const finding of findings) {
    if (inFlight.has(finding.id)) continue;
    inFlight.add(finding.id);
    summary.attempted++;

    try {
      const operation = findingOperation(finding);
      const payload = {
        event: "contract.breaking_change",
        findingId: finding.id,
        provider: finding.provider,
        fromVersion: finding.fromVersion,
        toVersion: finding.toVersion,
        severity: finding.severity,
        affectedApiPath: operation
          ? `${operation.method} ${operation.path}`
          : finding.path,
        findingPath: finding.path,
        explanation: finding.message,
        affectedConsumers: finding.impacts
          .map((impact) => impact.consumer.name)
          .sort(),
      };

      let response: Response;
      try {
        response = await fetcher(`${webhookBase}/contract-guard`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        summary.failed++;
        summary.failures.push({ findingId: finding.id, error });
        console.error(
          `[contract-guard] webhook delivery failed for finding ${finding.id}: ${error}`,
        );
        continue;
      }

      if (!response.ok) {
        const error = `webhook receiver returned HTTP ${response.status}`;
        summary.failed++;
        summary.failures.push({ findingId: finding.id, error });
        console.error(
          `[contract-guard] webhook delivery failed for finding ${finding.id}: ${error}`,
        );
        continue;
      }

      await prisma.finding.update({
        where: { id: finding.id },
        data: { notified: true },
      });
      summary.delivered++;
    } finally {
      inFlight.delete(finding.id);
    }
  }

  return summary;
}
