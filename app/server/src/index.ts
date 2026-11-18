import express from "express";
import fs from "node:fs";
import path from "node:path";
import healthRouter from "./routes/health";
import { router as catalogRouter } from "./routes/catalog";
import { router as importRouter } from "./routes/import";
import { router as analyzeRouter } from "./routes/analyze";
import { router as impactRouter } from "./routes/impact";
import { router as publishRouter } from "./routes/publish";
import { router as notificationsRouter } from "./routes/notifications";

const PORT = Number(process.env.PORT ?? 3001);
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" })); // import endpoints accept YAML text bodies

// --- API routes ---
app.use("/api", healthRouter);
app.use("/api", catalogRouter);
app.use("/api", importRouter);
app.use("/api", analyzeRouter);
app.use("/api", impactRouter);
app.use("/api", publishRouter);
app.use("/api", notificationsRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

// --- static web UI ---
// The Docker image ships the built web app as ../public; it is absent during
// local API-only development (the Vite dev server serves the UI instead).
const publicDir = path.join(__dirname, "..", "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback: any non-/api GET serves the app shell
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

app.listen(PORT, () => {
  console.log(`[contract-guard] API listening on http://localhost:${PORT}`);
  console.log(`[contract-guard] webhook receiver base: ${process.env.WEBHOOK_BASE ?? "http://localhost:9900"}`);
});
