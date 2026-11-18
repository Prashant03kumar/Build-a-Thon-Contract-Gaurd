// Import-lint: the findings Contract Guard raises purely from inspecting
// stored specs (no version comparison — that is M2):
//   SPEC_ERROR  spec-ref-unresolvable   unparseable YAML / dangling $ref (kit trap T1)
//   WARN        version-republished     same info.version at two publish slots (kit trap T2)
// Findings are fully recomputed per provider and replaced — never duplicated.
import { Prisma } from "@prisma/client";
import { parseSpec } from "./parseSpec";

export const SPEC_LINT_RULES = ["spec-ref-unresolvable", "version-republished"] as const;
export const CONSUMER_LINT_RULE = "consumer-manifest-invalid";

type SpecRow = {
  id: string;
  fileName: string;
  version: string; // "" = unknown
  publishOrder: number;
  raw: string | null;
};

type LintFinding = {
  rule: string;
  severity: string;
  path: string;
  message: string;
  fromVersion: string | null;
  toVersion: string | null;
};

/**
 * Re-parses every stored spec of a provider, refreshes valid/version/canonical,
 * then replaces the provider's lint findings (delete + recreate inside the
 * caller's transaction). Re-running is always safe: same input → same findings.
 */
export async function recomputeProviderLint(providerName: string, tx: Prisma.TransactionClient): Promise<number> {
  const rows: SpecRow[] = await tx.specVersion.findMany({
    where: { provider: { name: providerName } },
    orderBy: { publishOrder: "asc" },
    select: { id: true, fileName: true, version: true, publishOrder: true, raw: true },
  });

  const findings: LintFinding[] = [];

  for (const row of rows) {
    if (!row.raw) continue;
    const parsed = await parseSpec(row.raw);
    await tx.specVersion.update({
      where: { id: row.id },
      data: {
        valid: parsed.valid,
        version: parsed.version ?? row.version,
        canonical: parsed.resolved !== null ? JSON.stringify(parsed.resolved) : null,
      },
    });    if (!parsed.valid) {
      findings.push({
        rule: "spec-ref-unresolvable",
        severity: "SPEC_ERROR",
        path: row.fileName,
        message: parsed.error ?? "Invalid OpenAPI document",
        fromVersion: null,
        toVersion: parsed.version ?? row.version,
      });
    }
  }

  // republish detection: same version string at more than one publish slot
  const byVersion = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.version) continue;
    const list = byVersion.get(row.version) ?? [];
    list.push(row.fileName);
    byVersion.set(row.version, list);
  }
  for (const [version, fileNames] of byVersion) {
    if (fileNames.length < 2) continue;
    const [first, ...duplicates] = fileNames; // rows are publishOrder-ascending
    for (const fileName of duplicates) {
      findings.push({
        rule: "version-republished",
        severity: "WARN",
        path: fileName,
        message: `Version ${version} republished (first published as ${first}); publish order disambiguates the corrected copy.`,
        fromVersion: version,
        toVersion: version,
      });
    }
  }

  await tx.finding.deleteMany({
    where: { provider: providerName, rule: { in: [...SPEC_LINT_RULES] } },
  });
  if (findings.length > 0) {
    await tx.finding.createMany({ data: findings.map((f) => ({ provider: providerName, ...f })) });
  }
  return findings.length;
}
