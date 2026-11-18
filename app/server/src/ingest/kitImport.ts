// Kit import orchestrator.
//
// Idempotency strategy (safe to run any number of times):
//  - Provider:    upsert by unique name
//  - SpecVersion: upsert by (providerId, fileName); publishOrder comes from the
//                 file's numeric prefix ("3-price-lines.yaml" → 3) in sorted
//                 order; versions whose source file vanished are removed (true
//                 re-sync). Duplicate publish slots stay impossible via
//                 unique(providerId, publishOrder) — P2002 never surfaces here
//                 because one file occupies exactly one slot.
//  - Consumer:    upsert by unique name; usages are replaced wholesale.
//  - Findings:    lint findings are recomputed per provider / per consumer and
//                 replaced — repeated imports never stack duplicates.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { parseSpec, type SpecParseResult } from "./parseSpec";
import { parseConsumerManifest, type ParsedConsumer } from "./parseConsumer";
import { recomputeProviderLint, CONSUMER_LINT_RULE } from "./lint";

const YAML_FILE = /\.ya?ml$/i;

function listYamlFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && YAML_FILE.test(d.name))
    .map((d) => d.name)
    .sort();
}

// "3-price-lines.yaml" → 3; unnumbered files sort after numbered ones.
function fileRank(fileName: string): number {
  const match = /^(\d+)/.exec(fileName);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export type ImportDetail = { name: string; files: number; valid: number; invalid: number; lintFindings: number };
export type ImportSummary = {
  specsDir: string;
  consumersDir: string;
  providers: ImportDetail[];
  consumers: { name: string; team: string; usages: number }[];
  totals: {
    providers: number;
    specVersions: number;
    consumers: number;
    consumerUses: number;
    findings: number;
  };
};

export async function importKit(specsDir: string, consumersDir: string): Promise<ImportSummary> {
  if (!fs.existsSync(specsDir)) throw new Error(`specs folder not found: ${specsDir}`);
  if (!fs.existsSync(consumersDir)) throw new Error(`consumers folder not found: ${consumersDir}`);

  const providerDirs = fs
    .readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const details: ImportDetail[] = [];

  for (const providerName of providerDirs) {
    const dir = path.join(specsDir, providerName);
    const files = listYamlFiles(dir).sort((a, b) => fileRank(a) - fileRank(b) || a.localeCompare(b));

    const parsedFiles: {
      fileName: string;
      publishOrder: number;
      raw: string;
      parsed: SpecParseResult;
    }[] = [];
    for (const [index, fileName] of files.entries()) {
      const raw = fs.readFileSync(path.join(dir, fileName), "utf8");
      const parsed = await parseSpec(raw);
      parsedFiles.push({ fileName, publishOrder: index + 1, raw, parsed });
    }

    let lintFindings = 0;
    await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.upsert({
        where: { name: providerName },
        update: {},
        create: { name: providerName },
      });
      // re-sync: drop rows whose source file no longer exists
      await tx.specVersion.deleteMany({
        where: { providerId: provider.id, fileName: { notIn: files } },
      });
      for (const f of parsedFiles) {
        const data = {
          version: f.parsed.version ?? "", // "" = unknown (file did not parse)
          publishOrder: f.publishOrder,
          valid: f.parsed.valid,
          raw: f.raw,
          canonical: f.parsed.resolved !== null ? JSON.stringify(f.parsed.resolved) : null,
        };
        await tx.specVersion.upsert({
          where: { providerId_fileName: { providerId: provider.id, fileName: f.fileName } },
          update: data,
          create: { providerId: provider.id, fileName: f.fileName, ...data },
        });
      }
      lintFindings = await recomputeProviderLint(providerName, tx);
    });

    details.push({
      name: providerName,
      files: parsedFiles.length,
      valid: parsedFiles.filter((f) => f.parsed.valid).length,
      invalid: parsedFiles.filter((f) => !f.parsed.valid).length,
      lintFindings,
    });
  }

  const consumerSummaries: { name: string; team: string; usages: number }[] = [];
  for (const fileName of listYamlFiles(consumersDir)) {
    const raw = fs.readFileSync(path.join(consumersDir, fileName), "utf8");
    let parsed: ParsedConsumer;
    try {
      parsed = parseConsumerManifest(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.$transaction(async (tx) => {
        // a broken manifest becomes ONE finding, replaced on every import
        await tx.finding.deleteMany({ where: { rule: CONSUMER_LINT_RULE, consumer: fileName } });
        await tx.finding.create({
          data: {
            provider: "unknown",
            consumer: fileName,
            severity: "SPEC_ERROR",
            rule: CONSUMER_LINT_RULE,
            path: fileName,
            message: `Invalid consumer manifest: ${message}`,
          },
        });
      });
      consumerSummaries.push({ name: fileName, team: "", usages: 0 });
      continue;
    }
    const usages = await syncConsumer(parsed);
    consumerSummaries.push({ name: parsed.name, team: parsed.team, usages });
  }

  const [providers, specVersions, consumers, consumerUses, findings] = await Promise.all([
    prisma.provider.count(),
    prisma.specVersion.count(),
    prisma.consumer.count(),
    prisma.consumerUse.count(),
    prisma.finding.count(),
  ]);

  return {
    specsDir,
    consumersDir,
    providers: details,
    consumers: consumerSummaries,
    totals: { providers, specVersions, consumers, consumerUses, findings },
  };
}

/** Upsert one parsed consumer manifest and replace all of its usages. */
export async function syncConsumer(parsed: ParsedConsumer): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const consumer = await tx.consumer.upsert({
      where: { name: parsed.name },
      update: { team: parsed.team },
      create: { name: parsed.name, team: parsed.team },
    });
    await tx.consumerUse.deleteMany({ where: { consumerId: consumer.id } });
    if (parsed.usages.length > 0) {
      await tx.consumerUse.createMany({
        data: parsed.usages.map((u) => ({
          consumerId: consumer.id,
          providerName: u.providerName,
          method: u.method,
          pathRaw: u.pathRaw,
          pathNorm: u.pathNorm,
          sendsJson: JSON.stringify(u.sends),
          readsJson: JSON.stringify(u.reads),
        })),
      });
    }
    // a manifest that now parses cleanly clears any earlier invalid-manifest finding
    await tx.finding.deleteMany({ where: { rule: CONSUMER_LINT_RULE, consumer: parsed.name } });
    return parsed.usages.length;
  });
}
