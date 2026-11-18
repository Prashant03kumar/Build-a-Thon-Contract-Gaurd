import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { runAnalysis } from "./routes/analyze";
import { sendPendingBreakingNotifications } from "./notifications/webhook";

type CapturedNotification = {
  path: string;
  body: Record<string, unknown>;
};

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind to a TCP port");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function spec(responseFields: string[], addCreatedResponse = false): string {
  const properties: Record<string, { type: string }> = {
    id: { type: "string" },
  };
  for (const field of responseFields) properties[field] = { type: "string" };

  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "M4 notification test", version: "1.0.0" },
    paths: {
      "/records/{id}": {
        get: {
          operationId: "getRecord",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "object", properties },
                },
              },
            },
            ...(addCreatedResponse ? { "201": { description: "Created" } } : {}),
          },
        },
      },
    },
  });
}

async function main(): Promise<void> {
  const received: CapturedNotification[] = [];
  let responseStatus = 200;
  const receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        path: req.url ?? "",
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      });
      res.writeHead(responseStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: responseStatus < 300 }));
    });
  });

  const suffix = randomUUID();
  const providerName = `m4-test-provider-${suffix}`;
  const consumerName = `m4-webhook-test-${suffix}`;
  const failureProvider = `m4-failure-provider-${suffix}`;
  const providerIds: string[] = [];
  let consumerId: string | null = null;

  try {
    const port = await listen(receiver);
    const webhookBase = `http://127.0.0.1:${port}`;
    const provider = await prisma.provider.create({ data: { name: providerName } });
    providerIds.push(provider.id);
    const consumer = await prisma.consumer.create({
      data: { name: consumerName, team: "M4 test" },
    });
    consumerId = consumer.id;

    await prisma.consumerUse.create({
      data: {
        consumerId: consumer.id,
        providerName,
        method: "GET",
        pathRaw: "/records/{id}",
        pathNorm: "/records/{param}",
        sendsJson: "[]",
        readsJson: JSON.stringify(["name"]),
      },
    });
    await prisma.specVersion.createMany({
      data: [
        {
          providerId: provider.id,
          version: "1.0.0",
          publishOrder: 1,
          fileName: "1-before.yaml",
          valid: true,
          canonical: spec(["name"]),
        },
        {
          providerId: provider.id,
          version: "2.0.0",
          publishOrder: 2,
          fileName: "2-after.yaml",
          valid: true,
          canonical: spec([], true),
        },
      ],
    });

    const firstAnalysis = await runAnalysis({ webhookBase, provider: providerName });
    assert.strictEqual(firstAnalysis.created, 2, "analysis should create breaking and informational findings");
    assert.deepStrictEqual(firstAnalysis.notifications, {
      attempted: 1,
      delivered: 1,
      failed: 0,
    });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].path, "/contract-guard");
    assert.strictEqual(received[0].body.provider, providerName);
    assert.strictEqual(received[0].body.fromVersion, "1.0.0");
    assert.strictEqual(received[0].body.toVersion, "2.0.0");
    assert.strictEqual(received[0].body.severity, "BREAKING");
    assert.strictEqual(received[0].body.affectedApiPath, "GET /records/{param}");
    assert.strictEqual(received[0].body.findingPath, "name");
    assert.strictEqual(typeof received[0].body.explanation, "string");
    assert.deepStrictEqual(received[0].body.affectedConsumers, [consumerName]);

    const firstFinding = await prisma.finding.findFirstOrThrow({
      where: { provider: providerName, severity: "BREAKING" },
    });
    assert.strictEqual(firstFinding.notified, true);
    const infoFinding = await prisma.finding.findFirstOrThrow({
      where: { provider: providerName, severity: "INFO" },
    });
    assert.strictEqual(infoFinding.notified, false, "informational findings must not be notified");

    const secondAnalysis = await runAnalysis({ webhookBase, provider: providerName });
    assert.strictEqual(secondAnalysis.created, 0, "repeat analysis must reuse the existing finding");
    assert.strictEqual(secondAnalysis.notifications.attempted, 0);
    assert.strictEqual(received.length, 1, "repeat analysis must not duplicate delivery");
    const preservedFinding = await prisma.finding.findFirstOrThrow({
      where: { provider: providerName, severity: "BREAKING" },
    });
    assert.strictEqual(preservedFinding.id, firstFinding.id);
    assert.strictEqual(preservedFinding.notified, true);
    assert.strictEqual(
      (await prisma.finding.findUniqueOrThrow({ where: { id: infoFinding.id } })).notified,
      false,
    );

    const failingProviderRow = await prisma.provider.create({
      data: { name: failureProvider },
    });
    providerIds.push(failingProviderRow.id);
    await prisma.specVersion.createMany({
      data: [
        {
          providerId: failingProviderRow.id,
          version: "1.0.0",
          publishOrder: 1,
          fileName: "1-before.yaml",
          valid: true,
          canonical: spec(["name"]),
        },
        {
          providerId: failingProviderRow.id,
          version: "2.0.0",
          publishOrder: 2,
          fileName: "2-after.yaml",
          valid: true,
          canonical: spec([]),
        },
      ],
    });
    responseStatus = 503;
    const failedAnalysis = await runAnalysis({
      webhookBase,
      provider: failureProvider,
    });
    assert.strictEqual(failedAnalysis.created, 1);
    assert.strictEqual(
      failedAnalysis.notifications.failed,
      1,
      "receiver failure must not make analysis fail",
    );
    const failedFinding = await prisma.finding.findFirstOrThrow({
      where: { provider: failureProvider, severity: "BREAKING" },
    });
    assert.strictEqual(
      (await prisma.finding.findUniqueOrThrow({ where: { id: failedFinding.id } })).notified,
      false,
      "analysis must preserve findings when delivery fails",
    );

    responseStatus = 200;
    const retried = await sendPendingBreakingNotifications({
      webhookBase,
      provider: failureProvider,
    });
    assert.strictEqual(retried.delivered, 1, "a pending notification must be retryable");
    assert.strictEqual(
      (await prisma.finding.findUniqueOrThrow({ where: { id: failedFinding.id } })).notified,
      true,
    );
    const deliveredCount = received.length;
    await sendPendingBreakingNotifications({ webhookBase, provider: failureProvider });
    assert.strictEqual(received.length, deliveredCount, "successful retry must not be delivered again");

    console.log("M4 webhook checks passed: analysis, payload, failure, retry and duplicate prevention");
  } finally {
    await prisma.finding.deleteMany({
      where: { provider: { in: [providerName, failureProvider] } },
    });
    for (const id of providerIds) {
      await prisma.provider.delete({ where: { id } });
    }
    if (consumerId) {
      await prisma.consumer.delete({ where: { id: consumerId } });
    }
    if (receiver.listening) await close(receiver);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
