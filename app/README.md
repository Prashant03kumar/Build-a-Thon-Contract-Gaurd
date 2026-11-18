# Contract Guard — application

This folder contains everything we build. The starter kit (`../specs`, `../consumers`,
`../webhook-receiver`, `../docker-compose.yml`, `../README.md`) is **never modified** —
see `../PLAN.md` for the full plan.

## Runtime topology

```
Browser ──► Guard (Express API + built React UI) :3001
                 │
                 ├─ SQLite ✓ M1a (Docker: file:/data/guard.db · local: server/prisma/dev.db)
                 └─ webhook POSTs ──► webhook-receiver :9000 (host :9900)
```

| URL | What |
| --- | --- |
| http://localhost:3001 | Guard UI + API (Docker mode) |
| http://localhost:3001/api/health | Health JSON (API liveness + receiver reachability) |
| http://localhost:5173 | Web dev server (local dev mode) |
| http://localhost:9900 | Webhook receiver (live page / `GET /api/received`) |

## Option A — run everything with Docker (recommended)

```powershell
cd app
docker compose up --build
```

- UI + API: http://localhost:3001 (one image: multi-stage build compiles web, then Express serves it)
- Receiver: http://localhost:9900
- Stop: `Ctrl+C`, then `docker compose down`

Port conflict on 9900? `WEBHOOK_PORT=9950 docker compose up --build`

## Option B — local development (hot reload)

```powershell
# Terminal 1 — webhook receiver (either of these):
cd app ; docker compose up --build webhook-receiver
#   or, without Docker (receiver is plain Python stdlib):
#   $env:PORT="9900" ; python ..\webhook-receiver\app.py

# Terminal 2 — API on :3001
cd app\server
npm install
npm run db:migrate   # first time only — dev.db is provided, safe to re-run
npm run dev          # tsx watch — auto-restarts on file changes

# Terminal 3 — web on :5173 (proxies /api to :3001)
cd app\web
npm install
npm run dev
```

Open http://localhost:5173. `WEBHOOK_BASE` defaults to `http://localhost:9900`.

## Health check

```powershell
curl http://localhost:3001/api/health
```

```json
{
  "status": "ok",              // "degraded" = DB and/or receiver unusable
  "service": "contract-guard-api",
  "uptimeSeconds": 12,
  "timestamp": "2026-11-18T…",
  "database": {
    "reachable": true,
    "tables": { "providers": 0, "specVersions": 0, "consumers": 0, "consumerUses": 0, "findings": 0 },
    "error": null
  },
  "webhookReceiver": { "url": "…", "reachable": true, "latencyMs": 4, "error": null }
}
```

Other API: any unknown `/api/*` path returns `404 {"error":"not found"}`.

## API endpoints (implemented so far)

| Method & path | Status | Purpose |
| --- | --- | --- |
| `GET /api/health` | ✅ | Liveness of API + SQLite + webhook receiver (with per-table row counts) |
| `POST /api/kit/import` | ✅ | Import all specs + consumer manifests from the kit folders (idempotent) |
| `POST /api/providers/:name/specs` | ✅ | Upload one spec: `{ "fileName": "1-initial.yaml", "content": "<yaml text>" }` |
| `POST /api/consumers` | ✅ | Upload one consumer manifest: `{ "content": "<yaml text>" }` |
| `GET /api/providers` | ✅ | Providers + ordered versions + validity flags |
| `GET /api/consumers` | ✅ | Consumers + usages (sends/reads as arrays) |
| `GET /api/findings` | ✅ | Import-lint findings (SPEC_ERROR / WARN) |
| `POST /api/analyze` | ⏳ M2 | Version comparison + breaking-change detection |
| `POST /api/gate-check` | ⏳ M3 | Publish gate verdict |

## How the kit import works (M1b)

1. **Discover** — each subfolder of `specs/` becomes a provider (upsert by name); `*.yaml`
   files inside are ordered by their numeric prefix (`3-price-lines.yaml` → publishOrder 3).
2. **Validate** — every file: YAML parse → `SwaggerParser.validate()` (OpenAPI 3.0.3 schema
   + `$ref` resolution) → `dereference()` (all `$ref`s inlined). Results stored per row:
   `version` (`info.version`), `valid`, `raw` (audit trail), `canonical` (resolved JSON).
3. **Lint** — two checks, findings replaced (never duplicated) per import:
   - `spec-ref-unresolvable` (SPEC_ERROR): file that fails validation — e.g. the kit's
     dangling `ClaimDocumnt` ref in claims-api file 2.
   - `version-republished` (WARN): same `info.version` at two publish slots — e.g. claims
     `1.1.0` published twice (broken, then corrected).
4. **Store** — `SpecVersion` upserts by `(providerId, fileName)`; stale rows whose file
   vanished are removed; `unique(providerId, publishOrder)` makes duplicate slots impossible.
5. **Consumers** — manifests parsed into `Consumer` + `ConsumerUse` rows (`sends`/`reads`
   as JSON strings; `pathNorm` normalizes `{id}`/`{quoteId}` to `{param}`); usages are
   replaced wholesale each import.

Import is **safe to run repeatedly**: same input → same database state, same findings.

## Database (Prisma + SQLite) — done (M1a schema + M1b import)

Five tables (design rationale is commented inline in `server/prisma/schema.prisma`):

| Table | Purpose |
| --- | --- |
| `Provider` | one row per API provider (`quote-api`, `policy-api`, `claims-api`) |
| `SpecVersion` | one row per published spec; lineage = `(providerId, publishOrder)` |
| `Consumer` | one row per consuming service |
| `ConsumerUse` | one row per API call a consumer makes (`sends`/`reads` stored as JSON strings) |
| `Finding` | one row per detected issue (`notified` = webhook delivery flag) |

**Anti-duplicate guarantee:** `@@unique([providerId, publishOrder])` — a provider can
never hold two versions in the same publish slot. The version *string* itself may
repeat (claims-api republished 1.1.0 with a corrected `$ref`) — that is by design;
import linting (M1b) flags it as a WARN.

| Command (run in `app/server`) | What it does |
| --- | --- |
| `npm run db:migrate` | create/apply migrations in dev (`prisma/dev.db`) + regenerate client |
| `npm run db:deploy` | apply migrations non-interactively (what Docker runs at startup) |
| `npm run db:generate` | regenerate the Prisma client after schema edits |
| `npm run db:studio` | browse the data in Prisma Studio |
| `npm run db:smoke` | schema smoke test (constraints, cascades, cleanup) |

- **Docker:** migrations run automatically at container start against `file:/data/guard.db`,
  persisted in the `guard-data` volume across restarts.
- **Local dev:** `server/prisma/dev.db` (git-ignored, already created).

## What's in here

| Path | Purpose |
| --- | --- |
| `compose.yaml` | Our runtime: `guard` + kit's `webhook-receiver` (kit compose untouched) |
| `.dockerignore` / `.gitignore` | Keep images/repos clean |
| `server/` | Express + TypeScript API, Prisma/SQLite (`prisma/schema.prisma`, migrations, `smoke.ts`), multi-stage `Dockerfile` |
| `web/` | React + Vite + TypeScript + Tailwind v4 (`src/App.tsx` status page, `src/api/client.ts`) |

## Notes

- Done: scaffold (M0), database (M1a), import + validation + lint (M1b). Next: diff engine (M2) per `../PLAN.md`.
- If this project lives inside OneDrive, consider excluding `node_modules` from sync for speed.
- Import/validation/engine logic is intentionally **not** implemented yet.
