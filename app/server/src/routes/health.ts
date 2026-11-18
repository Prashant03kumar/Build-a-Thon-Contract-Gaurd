import { Router } from "express";
import { prisma } from "../db";

const router = Router();

const WEBHOOK_BASE = process.env.WEBHOOK_BASE ?? "http://localhost:9900";

/**
 * GET /api/health
 * Liveness of the API, the SQLite database and the starter-kit webhook receiver.
 * Always returns HTTP 200; the body distinguishes "ok" from "degraded"
 * (degraded = API alive but the DB and/or receiver is not usable).
 */
router.get("/health", async (_req, res) => {
  // --- database (Prisma/SQLite) ---
  let dbReachable = false;
  let dbError: string | null = null;
  let tables: Record<string, number> | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [providers, specVersions, consumers, consumerUses, findings] = await Promise.all([
      prisma.provider.count(),
      prisma.specVersion.count(),
      prisma.consumer.count(),
      prisma.consumerUse.count(),
      prisma.finding.count(),
    ]);
    tables = { providers, specVersions, consumers, consumerUses, findings };
    dbReachable = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  // --- starter-kit webhook receiver ---
  const startedAt = Date.now();
  let receiverReachable = false;
  let latencyMs: number | null = null;
  let receiverError: string | null = null;
  try {
    const response = await fetch(`${WEBHOOK_BASE}/api/received`, {
      signal: AbortSignal.timeout(1500),
    });
    receiverReachable = response.ok;
    latencyMs = Date.now() - startedAt;
  } catch (err) {
    receiverError = err instanceof Error ? err.message : String(err);
  }

  res.json({
    status: receiverReachable && dbReachable ? "ok" : "degraded",
    service: "contract-guard-api",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: { reachable: dbReachable, tables, error: dbError },
    webhookReceiver: { url: WEBHOOK_BASE, reachable: receiverReachable, latencyMs, error: receiverError },
  });
});

export default router;
