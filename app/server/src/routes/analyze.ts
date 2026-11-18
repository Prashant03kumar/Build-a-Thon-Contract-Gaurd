// Milestone 2, step 3 — POST /api/analyze
//
// For every provider: walk its versions in publishOrder and diff each
// consecutive pair. Reconcile findings so unchanged rows retain their IDs and
// notification status; import-lint findings (SPEC_ERROR / WARN) are untouched.
// Invalid specs (dangling $ref) are skipped safely: no diff starts from a
// version we could not resolve.
import { Router } from "express";
import { prisma } from "../db";
import { normalizeSpec } from "../engine/normalize";
import { diffSpecs, ENGINE_RULES } from "../engine/diff";
import { recomputeFindingImpacts } from "../engine/impact";
import {
  sendPendingBreakingNotifications,
  type NotificationOptions,
} from "../notifications/webhook";

export const router = Router();

export async function runAnalysis(
  notificationOptions: NotificationOptions = {},
): Promise<{
  created: number;
  providers: { provider: string; versions: number; validVersions: number; pairsCompared: number; findingsCreated: number }[];
  totals: { findings: number; impacts: number };
  notifications: { attempted: number; delivered: number; failed: number };
}> {
  const providers = await prisma.provider.findMany({
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { publishOrder: "asc" } } },
  });
  const report: { provider: string; versions: number; validVersions: number; pairsCompared: number; findingsCreated: number }[] = [];
  let created = 0;

  for (const provider of providers) {
    const existing = await prisma.finding.findMany({
      where: { provider: provider.name, rule: { in: [...ENGINE_RULES] } },
      orderBy: [{ notified: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const existingByKey = new Map<string, typeof existing>();
    for (const finding of existing) {
      const key = findingKey(finding);
      const bucket = existingByKey.get(key) ?? [];
      bucket.push(finding);
      existingByKey.set(key, bucket);
    }
    const retainedIds = new Set<string>();

    let providerCreated = 0;
    let pairsCompared = 0;
    const validVersions = provider.versions.filter((v) => v.valid && v.canonical);

    for (let i = 1; i < validVersions.length; i++) {
      const prev = validVersions[i - 1];
      const next = validVersions[i];
      try {
        const drafts = diffSpecs(
          normalizeSpec(JSON.parse(prev.canonical as string)),
          normalizeSpec(JSON.parse(next.canonical as string)),
          { fromVersion: prev.version, toVersion: next.version },
        );
        if (drafts.length > 0) {
          for (const draft of drafts) {
            const data = {
              provider: provider.name,
              fromVersion: prev.version,
              toVersion: next.version,
              severity: draft.severity,
              rule: draft.rule,
              path: draft.path,
              message: draft.message,
            };
            const key = findingKey(data);
            const prior = existingByKey.get(key)?.shift();
            if (prior) {
              retainedIds.add(prior.id);
            } else {
              await prisma.finding.create({ data: { ...data, notified: false } });
              providerCreated++;
            }
          }
        }
        pairsCompared++;
      } catch {
        // Corrupt canonical data must not stop analysis of other providers.
      }
    }

    const obsoleteIds = existing
      .filter((finding) => !retainedIds.has(finding.id))
      .map((finding) => finding.id);
    if (obsoleteIds.length > 0) {
      await prisma.finding.deleteMany({ where: { id: { in: obsoleteIds } } });
    }

    report.push({
      provider: provider.name,
      versions: provider.versions.length,
      validVersions: validVersions.length,
      pairsCompared,
      findingsCreated: providerCreated,
    });
    created += providerCreated;
  }

  const impacts = await recomputeFindingImpacts();
  const notifications = await sendPendingBreakingNotifications(notificationOptions);
  const findings = await prisma.finding.count();
  return {
    created,
    providers: report,
    totals: { findings, impacts },
    notifications: {
      attempted: notifications.attempted,
      delivered: notifications.delivered,
      failed: notifications.failed,
    },
  };
}

function findingKey(finding: {
  provider: string;
  fromVersion: string | null;
  toVersion: string | null;
  severity: string;
  rule: string;
  path: string;
  message: string;
}): string {
  return JSON.stringify([
    finding.provider,
    finding.fromVersion,
    finding.toVersion,
    finding.severity,
    finding.rule,
    finding.path,
    finding.message,
  ]);
}

router.post("/analyze", async (_req, res) => {
  try {
    res.json(await runAnalysis());
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});
