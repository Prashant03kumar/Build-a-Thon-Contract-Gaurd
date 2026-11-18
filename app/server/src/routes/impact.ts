import { Router } from "express";
import { prisma } from "../db";

export const router = Router();

router.get("/impacts", async (_req, res) => {
  try {
    const findings = await prisma.finding.findMany({
      orderBy: [{ provider: "asc" }, { toVersion: "asc" }, { createdAt: "desc" }],
      include: {
        impacts: {
          include: { consumer: true },
          orderBy: { consumer: { name: "asc" } },
        },
      },
    });
    res.json({
      findings: findings.map((finding) => ({
        id: finding.id,
        provider: finding.provider,
        fromVersion: finding.fromVersion,
        toVersion: finding.toVersion,
        severity: finding.severity,
        rule: finding.rule,
        path: finding.path,
        message: finding.message,
        affectedConsumers: finding.impacts.map((impact) => impact.consumer.name),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
