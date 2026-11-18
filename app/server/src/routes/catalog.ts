// Read endpoints for imported data (Milestone 1b):
//   GET /api/providers  — providers with ordered versions + validity
//   GET /api/consumers  — consumers with usages (sends/reads as arrays)
//   GET /api/findings   — lint/diff findings, newest first
import { Router } from "express";
import { prisma } from "../db";

export const router = Router();

router.get("/providers", async (_req, res) => {
  const providers = await prisma.provider.findMany({
    orderBy: { name: "asc" },
    include: {
      versions: {
        orderBy: { publishOrder: "asc" },
        select: {
          fileName: true,
          version: true,
          publishOrder: true,
          valid: true,
        },
      },
    },
  });
  res.json(
    providers.map((p: (typeof providers)[number]) => ({
      name: p.name,
      versions: p.versions,
    })),
  );
});

router.get("/consumers", async (_req, res) => {
  const consumers = await prisma.consumer.findMany({
    orderBy: { name: "asc" },
    include: {
      usages: {
        orderBy: [
          { providerName: "asc" },
          { method: "asc" },
          { pathNorm: "asc" },
        ],
      },
    },
  });
  res.json(
    consumers.map((c) => ({
      name: c.name,
      team: c.team,
      usages: c.usages.map((u) => ({
        provider: u.providerName,
        method: u.method,
        path: u.pathRaw,
        sends: JSON.parse(u.sendsJson) as string[],
        reads: JSON.parse(u.readsJson) as string[],
      })),
    })),
  );
});

router.get("/findings", async (_req, res) => {
  const findings = await prisma.finding.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  res.json(findings);
});
