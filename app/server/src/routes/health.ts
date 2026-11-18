import { Router } from "express";

const router = Router();

const WEBHOOK_BASE = process.env.WEBHOOK_BASE ?? "http://localhost:9900";

/**
 * GET /api/health
 * Liveness for the API plus reachability of the starter-kit webhook receiver.
 * Always returns HTTP 200; the body says whether we are fully "ok" or "degraded"
 * (degraded = API alive, receiver unreachable — expected when running locally
 * without the receiver container).
 */
router.get("/health", async (_req, res) => {
  const startedAt = Date.now();
  let reachable = false;
  let latencyMs: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(`${WEBHOOK_BASE}/api/received`, {
      signal: AbortSignal.timeout(1500),
    });
    reachable = response.ok;
    latencyMs = Date.now() - startedAt;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  res.json({
    status: reachable ? "ok" : "degraded",
    service: "contract-guard-api",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    webhookReceiver: { url: WEBHOOK_BASE, reachable, latencyMs, error },
  });
});

export default router;
