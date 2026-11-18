import { Router } from "express";
import { sendPendingBreakingNotifications } from "../notifications/webhook";

export const router = Router();

router.post("/notifications/retry", async (_req, res) => {
  try {
    res.json(await sendPendingBreakingNotifications());
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});
