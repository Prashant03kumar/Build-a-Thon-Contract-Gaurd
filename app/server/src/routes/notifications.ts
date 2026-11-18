import { Router } from "express";
import { sendPendingBreakingNotifications } from "../notifications/webhook";

export const router = Router();

// Demo helper (PLAN.md stretch list): wipe the starter-kit receiver so repeated
// demonstrations start from an empty page. Server-side call — no CORS issue.
router.post("/notifications/clear-receiver", async (_req, res) => {
  const base = (process.env.WEBHOOK_BASE ?? "http://localhost:9900").replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/api/received`, { method: "DELETE", signal: AbortSignal.timeout(3000) });
    res.json({ cleared: response.ok, status: response.status });
  } catch (err) {
    res.json({ cleared: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Default (no body): re-deliver only PENDING notifications — success never
// double-posts. Body { "resendAll": true }: re-deliver every BREAKING finding,
// for demo resets after "Clear receiver".
router.post("/notifications/retry", async (req, res) => {
  try {
    const resendAll = (req.body ?? {}).resendAll === true;
    res.json(await sendPendingBreakingNotifications({ resendAll }));
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});
