import express from "express";
import fs from "node:fs";
import path from "node:path";
import healthRouter from "./routes/health";

const PORT = Number(process.env.PORT ?? 3001);
const app = express();

app.disable("x-powered-by");

// --- API routes ---
app.use("/api", healthRouter);
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
