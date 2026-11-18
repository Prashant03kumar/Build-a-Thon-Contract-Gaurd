import { Router } from "express";
import { prisma } from "../db";

export const router = Router();

async function gate(providerName: string, body: Record<string, unknown>, res: any) {
  const targetVersion = typeof body.version === "string"
    ? body.version.trim()
    : typeof body.targetVersion === "string"
      ? body.targetVersion.trim()
      : "";
  const publishOrder = typeof body.publishOrder === "number"
    ? body.publishOrder
    : typeof body.publishOrder === "string" && body.publishOrder.trim()
      ? Number(body.publishOrder)
      : null;

  if (!providerName) return res.status(400).json({ error: "provider is required" });
  if (!targetVersion && publishOrder === null) {
    return res.status(400).json({ error: "version or publishOrder is required" });
  }

  const provider = await prisma.provider.findUnique({
    where: { name: providerName },
    include: { versions: { orderBy: { publishOrder: "asc" } } },
  });
  if (!provider) return res.status(404).json({ error: `provider '${providerName}' was not found` });

  let target;
  if (publishOrder !== null) {
    if (!Number.isInteger(publishOrder) || publishOrder < 1) {
      return res.status(400).json({ error: "publishOrder must be a positive integer" });
    }
    target = provider.versions.find((v) => v.publishOrder === publishOrder);
  } else {
    const matches = provider.versions.filter((v) => v.version === targetVersion);
    if (matches.length === 0) return res.status(404).json({ error: `version '${targetVersion}' was not found for provider '${providerName}'` });
    if (matches.length > 1) {
      return res.status(400).json({
        error: `version '${targetVersion}' is ambiguous; specify publishOrder`,
        matches: matches.map((v) => ({ publishOrder: v.publishOrder, fileName: v.fileName })),
      });
    }
    target = matches[0];
  }

  if (!target) return res.status(404).json({ error: `publish order ${publishOrder} was not found for provider '${providerName}'` });
  if (!target.valid) {
    return res.status(400).json({
      error: `target version '${target.version}' at publishOrder ${target.publishOrder} is invalid and cannot be published`,
      publishOrder: target.publishOrder,
      version: target.version,
    });
  }

  const findings = await prisma.finding.findMany({
    where: {
      provider: providerName,
      toVersion: target.version,
    },
    include: {
      impacts: { include: { consumer: true } },
    },
  });

  const consumerBreaking = findings.filter(
    (finding) => finding.severity === "BREAKING" && finding.impacts.length > 0,
  );
  const internalWarnings = findings.filter(
    (finding) =>
      (finding.severity === "BREAKING" && /x-internal endpoint/i.test(finding.message))
      || (finding.severity !== "INFO" && finding.severity !== "BREAKING" && finding.impacts.length === 0),
  );

  const affectedConsumers = [...new Set(
    consumerBreaking.flatMap((finding) => finding.impacts.map((impact) => impact.consumer.name)),
  )].sort();
  const breakingFields = consumerBreaking.map((finding) => finding.path);
  const blocked = consumerBreaking.length > 0;
  const warned = internalWarnings.length > 0;

  return res.json({
    decision: blocked ? "BLOCKED" : "ALLOWED",
    result: blocked ? "block" : warned ? "warn" : "allow",
    blocked,
    provider: providerName,
    publishOrder: target.publishOrder,
    version: target.version,
    affectedConsumers,
    breakingFields,
    explanation: blocked
      ? `Publishing is blocked because ${affectedConsumers.join(", ") || "registered consumers"} would be affected.`
      : warned
        ? "Publishing is allowed for external consumers, but provider-internal warnings are present."
        : "No consumer-facing breaking changes were found; publishing is allowed.",
    warnings: internalWarnings.map((finding) => ({
      rule: finding.rule,
      path: finding.path,
      message: finding.message,
    })),
  });
}

router.post("/gate-check", (req, res) =>
  gate(String((req.body ?? {}).provider ?? "").trim(), req.body ?? {}, res),
);

router.post("/publish/check", (req, res) =>
  gate(String((req.body ?? {}).provider ?? "").trim(), req.body ?? {}, res),
);
