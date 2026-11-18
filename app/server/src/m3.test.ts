import assert from "node:assert";
import { kitDirs } from "./ingest/kitPaths";
import { importKit } from "./ingest/kitImport";
import { runAnalysis } from "./routes/analyze";
import { prisma } from "./db";

async function main(): Promise<void> {
  const dirs = kitDirs();
  await importKit(dirs.specsDir, dirs.consumersDir);

  const first = await runAnalysis();
  const findingCountAfterFirst = await prisma.finding.count();
  const second = await runAnalysis();
  assert.strictEqual(second.created, 0, "repeat analysis must not create engine findings");
  assert.strictEqual(
    await prisma.finding.count(),
    findingCountAfterFirst,
    "repeat analysis must not duplicate findings",
  );

  const findings = await prisma.finding.findMany({
    include: { impacts: { include: { consumer: true } } },
  });
  const namesFor = (rule: string) => [
    ...new Set(
      findings
        .filter((finding) => finding.rule === rule)
        .flatMap((finding) => finding.impacts.map((impact) => impact.consumer.name)),
    ),
  ].sort();

  assert(namesFor("response-field-renamed").includes("mobile-app"), "B1 must affect mobile-app");
  assert(namesFor("response-field-removed").includes("payments-svc"), "B3 must affect payments-svc");
  assert(namesFor("request-field-required-added").includes("partner-portal"), "B4 must affect partner-portal");
  assert(namesFor("request-enum-narrowed").includes("partner-portal"), "B5 must affect partner-portal");

  const b6 = findings.filter((finding) => finding.rule === "request-param-required-added");
  assert(b6.length > 0, "B6 should remain present");
  assert(b6.every((finding) => finding.impacts.length === 0), "B6 must not be externally attributed");

  const allImpacts = findings.flatMap((finding) => finding.impacts.map((impact) => impact.consumer.name));
  assert(!allImpacts.includes("notifications-svc"), "unrelated notifications consumer must not be affected");

  const quoteV3 = await prisma.specVersion.findFirst({
    where: { provider: { name: "quote-api" }, publishOrder: 3 },
  });
  const quoteBlock = await prisma.finding.findMany({
    where: { provider: "quote-api", toVersion: quoteV3?.version, severity: "BREAKING" },
    include: { impacts: true },
  });
  assert(quoteBlock.some((finding) => finding.impacts.length > 0), "quote 2.0.0 must block for consumer-facing breaking changes");

  const quoteV4 = await prisma.specVersion.findFirst({
    where: { provider: { name: "quote-api" }, publishOrder: 4 },
  });
  const quoteSafe = await prisma.finding.findMany({
    where: { provider: "quote-api", toVersion: quoteV4?.version, severity: "BREAKING" },
  });
  assert.strictEqual(quoteSafe.length, 0, "quote 2.1.0 should be a safe release");

  const quoteB6 = findings.find((finding) => finding.rule === "request-param-required-added");
  assert(quoteB6 && quoteB6.impacts.length === 0, "internal-only release must not falsely block");

  const impactCount = await prisma.findingConsumer.count();
  console.log(JSON.stringify({
    firstAnalysisCreated: first.created,
    secondAnalysisCreated: second.created,
    findingCount: await prisma.finding.count(),
    impactCount,
  }));
  console.log("M3 checks passed");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
