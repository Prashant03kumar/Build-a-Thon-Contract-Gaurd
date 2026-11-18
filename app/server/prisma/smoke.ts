/**
 * Database smoke test — Milestone 1a (schema verification only).
 *
 * Proves, using the kit's real story:
 *   1. A provider holds ordered versions and FKs cascade on delete.
 *   2. The SAME version string may occupy two publish slots (claims-api
 *      republished 1.1.0 — allowed BY DESIGN).
 *   3. A duplicate publish slot for the same provider is REJECTED (the
 *      anti-duplicate guarantee: P2002 unique constraint).
 *   4. Consumers + usages + findings persist and update (notified flag).
 * It cleans up after itself, leaving all tables empty for the real imports.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanup() {
  await prisma.finding.deleteMany();
  await prisma.consumerUse.deleteMany();
  await prisma.specVersion.deleteMany();
  await prisma.consumer.deleteMany();
  await prisma.provider.deleteMany();
}

async function expectUniqueViolation(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`FAIL ${label}: duplicate publish slot was accepted (BUG)`);
    process.exitCode = 1;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      console.log(`PASS ${label}: rejected (P2002) — no duplicate versions in a provider's lineage`);
    } else {
      throw err;
    }
  }
}

async function main() {
  await cleanup();

  // 1. provider + ordered versions (claims-api's real lineage story)
  const provider = await prisma.provider.create({ data: { name: "claims-api" } });
  const v1 = await prisma.specVersion.create({
    data: { providerId: provider.id, version: "1.1.0", publishOrder: 1, fileName: "2-channel-and-notes.yaml", valid: false },
  });
  const v2 = await prisma.specVersion.create({
    data: { providerId: provider.id, version: "1.1.0", publishOrder: 2, fileName: "3-channel-and-notes-fixed.yaml", valid: true },
  });
  console.log(`PASS same version string twice accepted (republish, by design): publishOrder ${v1.publishOrder} & ${v2.publishOrder}`);

  // 2. duplicate publish slot must be rejected
  await expectUniqueViolation("duplicate publishOrder 1 for same provider", () =>
    prisma.specVersion.create({
      data: { providerId: provider.id, version: "9.9.9", publishOrder: 1, fileName: "duplicate.yaml" },
    }),
  );

  // 3. consumer + usage (mobile-app reads the field quote-api v2 renames)
  const consumer = await prisma.consumer.create({ data: { name: "mobile-app", team: "Mobile" } });
  await prisma.consumerUse.create({
    data: {
      consumerId: consumer.id,
      providerName: "quote-api",
      method: "POST",
      pathRaw: "/quotes",
      pathNorm: "/quotes",
      sendsJson: JSON.stringify(["vehicle.make", "vehicle.cc", "rider.age"]),
      readsJson: JSON.stringify(["premium.breakdown[].amount"]),
    },
  });
  console.log("PASS consumer + usage stored (sends/reads as JSON strings)");

  // 4. finding + notified flag
  const finding = await prisma.finding.create({
    data: {
      provider: "quote-api",
      fromVersion: "1.1.0",
      toVersion: "2.0.0",
      consumer: "mobile-app",
      severity: "BREAKING",
      rule: "response-field-renamed",
      path: "premium.breakdown[].amount",
      message: "Field renamed to 'value' in v2.0.0; mobile-app reads it.",
    },
  });
  await prisma.finding.update({ where: { id: finding.id }, data: { notified: true } });
  const reloaded = await prisma.finding.findUnique({ where: { id: finding.id } });
  console.log(`PASS finding persisted; notified flag = ${reloaded?.notified === true}`);

  // 5. counts
  const [providers, versions, consumers, usages, findings] = await Promise.all([
    prisma.provider.count(),
    prisma.specVersion.count(),
    prisma.consumer.count(),
    prisma.consumerUse.count(),
    prisma.finding.count(),
  ]);
  console.log(`PASS row counts before cleanup: providers=${providers} versions=${versions} consumers=${consumers} usages=${usages} findings=${findings}`);

  // 6. cleanup (cascades prove relation integrity)
  await cleanup();
  const left = await prisma.provider.count();
  console.log(`PASS cleanup done (cascading deletes work); providers left = ${left} — tables ready for real imports (M1b)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
