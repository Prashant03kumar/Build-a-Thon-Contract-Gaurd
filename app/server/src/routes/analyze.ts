// Milestone 2, step 3 — POST /api/analyze
//
// For every provider: walk its versions in publishOrder, diff each
// consecutive pair, store the findings. Idempotent: engine findings are
// deleted and recomputed per run, so repeating an analysis never creates
// duplicates — and the import-lint findings (SPEC_ERROR / WARN) are untouched.
// Invalid specs (dangling $ref) are skipped safely: no diff starts from a
// version we could not resolve.
import { Router } from "express";
import { prisma } from "../db";
import { normalizeSpec } from "../engine/normalize";
import { diffSpecs, ENGINE_RULES } from "../engine/diff";
import { recomputeFindingImpacts } from "../engine/impact";

export const router = Router();

export async function runAnalysis(): Promise<{
  created: number;
  providers: { provider: string; versions: number; validVersions: number; pairsCompared: number; findingsCreated: number }[];
  totals: { findings: number; impacts: number };
}> {
  const providers = await prisma.provider.findMany({
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { publishOrder: "asc" } } },
  });
  const report: { provider: string; versions: number; validVersions: number; pairsCompared: number; findingsCreated: number }[] = [];
  let created = 0;

  for (const provider of providers) {
    await prisma.finding.deleteMany({
      where: { provider: provider.name, rule: { in: [...ENGINE_RULES] } },
    });
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
          const result = await prisma.finding.createMany({
            data: drafts.map((d) => ({
              provider: provider.name,
              fromVersion: prev.version,
              toVersion: next.version,
              consumer: null,
              severity: d.severity,
              rule: d.rule,
              path: d.path,
              message: d.message,
              notified: false,
            })),
          });
          providerCreated += result.count;
        }
        pairsCompared++;
      } catch {
        // Corrupt canonical data must not stop analysis of other providers.
      }
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
  const findings = await prisma.finding.count();
  return { created, providers: report, totals: { findings, impacts } };
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
