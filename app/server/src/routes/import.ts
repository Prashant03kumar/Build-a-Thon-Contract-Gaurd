// Import endpoints (Milestone 1b):
//   POST /api/kit/import              — import all specs + consumers from the kit folders
//   POST /api/providers/:name/specs   — upload one spec (F1 upload path)
//   POST /api/consumers               — upload one consumer manifest (F1 upload path)
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
// import type { Prisma } from "@prisma/client";
import { importKit, syncConsumer } from "../ingest/kitImport";
import { parseSpec } from "../ingest/parseSpec";
import { parseConsumerManifest } from "../ingest/parseConsumer";
import { recomputeProviderLint } from "../ingest/lint";

export const router = Router();

// Kit data locations: compose mounts the folders at $KIT_DATA_DIR/specs|consumers;
// locally, the starter kit sits two levels above app/server (the npm cwd).
function defaultKitDir(sub: "specs" | "consumers"): string {
  const base = [
    path.resolve(process.cwd(), "..", ".."), // app/server → starter-kit root
    path.resolve(process.cwd(), "..", "..", ".."), // fallback for alternate cwd
  ].find((candidate) => fs.existsSync(path.join(candidate, sub)));
  return path.join(base ?? path.resolve(process.cwd(), "..", ".."), sub);
}

function kitDirs() {
  const specsDir =
    process.env.KIT_SPECS_DIR ??
    (process.env.KIT_DATA_DIR
      ? path.join(process.env.KIT_DATA_DIR, "specs")
      : defaultKitDir("specs"));
  const consumersDir =
    process.env.KIT_CONSUMERS_DIR ??
    (process.env.KIT_DATA_DIR
      ? path.join(process.env.KIT_DATA_DIR, "consumers")
      : defaultKitDir("consumers"));
  return { specsDir, consumersDir };
}

router.post("/kit/import", async (_req, res) => {
  try {
    const { specsDir, consumersDir } = kitDirs();
    const summary = await importKit(specsDir, consumersDir);
    res.json(summary);
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/providers/:name/specs", async (req, res) => {
  const providerName = String(req.params.name ?? "").trim();
  const body = (req.body ?? {}) as { fileName?: unknown; content?: unknown };
  const fileName =
    typeof body.fileName === "string" ? body.fileName.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(providerName)) {
    return res
      .status(400)
      .json({ error: "provider name must be alphanumeric or dashes" });
  }
  if (
    !fileName ||
    !/\.ya?ml$/i.test(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    return res.status(400).json({
      error: "body.fileName must be a bare YAML file name, e.g. 1-initial.yaml",
    });
  }
  if (!content.trim()) {
    return res
      .status(400)
      .json({ error: "body.content must contain the raw YAML text" });
  }

  try {
    const parsed = await parseSpec(content);
    const lintFindings = await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.upsert({
        where: { name: providerName },
        update: {},
        create: { name: providerName },
      });
      const existing = await tx.specVersion.findUnique({
        where: { providerId_fileName: { providerId: provider.id, fileName } },
        select: { publishOrder: true },
      });
      const publishOrder = existing
        ? existing.publishOrder
        : ((
            await tx.specVersion.aggregate({
              where: { providerId: provider.id },
              _max: { publishOrder: true },
            })
          )._max.publishOrder ?? 0) + 1;
      const data = {
        version: parsed.version ?? "", // "" = unknown (file did not parse)
        publishOrder,
        valid: parsed.valid,
        raw: content,
        canonical:
          parsed.resolved !== null ? JSON.stringify(parsed.resolved) : null,
      };
      await tx.specVersion.upsert({
        where: { providerId_fileName: { providerId: provider.id, fileName } },
        update: data,
        create: { providerId: provider.id, fileName, ...data },
      });
      return recomputeProviderLint(providerName, tx);
    });
    res.json({
      provider: providerName,
      fileName,
      version: parsed.version,
      valid: parsed.valid,
      error: parsed.error,
      lintFindings,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/consumers", async (req, res) => {
  const body = (req.body ?? {}) as { content?: unknown };
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim())
    return res
      .status(400)
      .json({ error: "body.content must contain the manifest YAML text" });
  try {
    const parsed = parseConsumerManifest(content);
    const usages = await syncConsumer(parsed);
    res.json({ consumer: parsed.name, team: parsed.team, usages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Invalid consumer manifest: ${message}` });
  }
});
