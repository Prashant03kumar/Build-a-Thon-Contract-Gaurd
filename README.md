# Contract Guard

Contract Guard is an API contract registry and publishing-safety checker for
versioned provider APIs. It imports OpenAPI specifications and consumer usage
manifests, detects selected breaking changes, identifies registered affected
consumers and exposes a publishing gate.

The current MVP has completed M0–M4. The React app is still a health-status
scaffold; the full dashboard is planned, not implemented. See
[DESIGN.md](./DESIGN.md) for architecture and
[PROGRESS.md](./PROGRESS.md) for status and evidence. [PLAN.md](./PLAN.md)
contains the original product requirements.

## Implemented features

- Import and validate OpenAPI specifications, resolve `$ref`s, retain invalid
  inputs and report selected import lint findings.
- Store provider versions by publish order, including repeated version strings.
- Compare consecutive valid versions and record breaking/informational findings.
- Match supported breaking findings to consumer usage records; exclude
  `x-internal` operations from external consumer attribution.
- Check releases through a publishing-gate API.
- Notify the webhook receiver about pending BREAKING findings and retry failed
  deliveries.
- Run locally with Docker Compose or as separate server and Vite processes.

## Technology stack and prerequisites

- Node.js 20 or newer and npm.
- Docker Desktop with Docker Compose v2 (recommended), or Python 3 for running
  the starter-kit webhook receiver without Docker.
- Backend: Express, TypeScript, Prisma and SQLite.
- Frontend: React, Vite, TypeScript and Tailwind CSS v4.

Tests currently use `tsx` and Node's assertion library. Vitest is listed in the
original plan but is not installed/configured in the current packages.

## Installation and setup

Clone or open the project, then work from its root directory. The supplied
`specs/` and `consumers/` folders are read-only input for the importer; do not
modify them for normal development.

### Option A: Docker Compose (recommended)

Docker Compose builds the API/UI container and the webhook-receiver container.
The starter-kit folders are mounted read-only and the SQLite database persists
in a named volume.

```powershell
cd app
docker compose up --build
```

Open:

- Contract Guard UI/API: <http://localhost:3001>
- Health endpoint: <http://localhost:3001/api/health>
- Starter-kit webhook receiver: <http://localhost:9900>

Stop with `Ctrl+C`, or from another terminal run:

```powershell
cd app
docker compose down
```

To change the receiver's host port, set `WEBHOOK_PORT` before starting Compose:

```powershell
$env:WEBHOOK_PORT = "9950"
docker compose up --build
```

The receiver will then be available on port 9950. Do not use `docker compose
down -v` unless you intend to delete the persisted database volume.

### Option B: local development

Open three terminals. Local development uses the same Compose file to run the
receiver, while the API and frontend run in Node.

**Terminal 1 — webhook receiver**

```powershell
cd app
docker compose up webhook-receiver
```

Alternatively, run its standard-library Python app directly:

```powershell
cd app
$env:PORT = "9900"
python webhook-receiver\app.py
```

**Terminal 2 — API**

```powershell
cd app\server
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

The API listens on port 3001 by default. When `DATABASE_URL` is unset, the
server's Prisma client defaults to `app/server/prisma/dev.db`. Prisma CLI
commands require `DATABASE_URL`; configure it in the server's environment or
local `.env` file, for example:

```dotenv
DATABASE_URL="file:./dev.db"
```

The value above is a local SQLite path, not a secret. Do not commit credentials
or private connection strings.

**Terminal 3 — frontend**

```powershell
cd app\web
npm ci
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` calls to
<http://localhost:3001>.

## Environment variables

No API keys or passwords are required by the current local setup.

| Variable | Default/Compose value | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Express API port. The receiver uses its own `PORT` (`9000` in Compose). |
| `DATABASE_URL` | Local server fallback: `app/server/prisma/dev.db`; Compose: `file:/data/guard.db` | Prisma SQLite connection string. |
| `WEBHOOK_BASE` | `http://localhost:9900` | Receiver base URL used by the API health check. Compose sets the service URL. |
| `KIT_DATA_DIR` | Local kit paths are discovered from the working directory; Compose sets `/kit` | Base directory containing `specs/` and `consumers/`. |
| `KIT_SPECS_DIR` | Derived from `KIT_DATA_DIR` or local kit location | Optional explicit specs directory override. |
| `KIT_CONSUMERS_DIR` | Derived from `KIT_DATA_DIR` or local kit location | Optional explicit consumer-manifests directory override. |
| `WEBHOOK_PORT` | `9900` | Host port mapped to the receiver by Compose. |

## Import and analyze the starter kit

With the API running, use PowerShell's `Invoke-RestMethod`:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3001/api/kit/import" `
  -ContentType "application/json" `
  -Body "{}"

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3001/api/analyze" `
  -ContentType "application/json" `
  -Body "{}"
```

The import response reports provider/spec/consumer counts and lint findings.
Analysis reports findings created per provider plus total findings and impact
associations. Running import/analyze again is intended to be idempotent.

To inspect stored results:

```powershell
Invoke-RestMethod "http://localhost:3001/api/providers"
Invoke-RestMethod "http://localhost:3001/api/consumers"
Invoke-RestMethod "http://localhost:3001/api/findings"
Invoke-RestMethod "http://localhost:3001/api/impacts"
```

## API reference

All API paths are prefixed with `/api`; JSON request examples below assume the
server is listening on `localhost:3001`.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | API, database and webhook-receiver health. |
| `GET /api/providers` | Providers and ordered version metadata. |
| `GET /api/consumers` | Consumer details and registered usages. |
| `GET /api/findings` | Stored findings, newest first. |
| `GET /api/impacts` | Findings with affected consumer names. |
| `POST /api/kit/import` | Import mounted/local starter-kit data. |
| `POST /api/providers/:name/specs` | Upload one YAML specification. |
| `POST /api/consumers` | Upload one YAML consumer manifest. |
| `POST /api/analyze` | Recompute diffs and consumer impacts. |
| `POST /api/notifications/retry` | Retry pending BREAKING finding notifications. |
| `POST /api/gate-check` | Check whether a release has consumer-facing breaks. |
| `POST /api/publish/check` | Alias for `/api/gate-check`. |

### Health

```http
GET /api/health
```

Example response shape:

```json
{
  "status": "ok",
  "service": "contract-guard-api",
  "uptimeSeconds": 12,
  "timestamp": "2026-11-18T00:00:00.000Z",
  "database": {
    "reachable": true,
    "tables": {
      "providers": 3,
      "specVersions": 12,
      "consumers": 4,
      "consumerUses": 10,
      "findings": 22
    },
    "error": null
  },
  "webhookReceiver": {
    "url": "http://localhost:9900",
    "reachable": true,
    "latencyMs": 4,
    "error": null
  }
}
```

Counts are illustrative and depend on the database; an unreachable database or
receiver is reported as `degraded` in the response body.

### Import a spec or consumer manifest

`POST /api/providers/:name/specs` expects a bare YAML filename and YAML
contents:

```json
{
  "fileName": "5-next.yaml",
  "content": "openapi: 3.0.3\ninfo:\n  title: Example API\n  version: 3.0.0\npaths: {}\n"
}
```

`POST /api/consumers` accepts a manifest as YAML text:

```json
{
  "content": "consumer: checkout\nteam: Commerce\nuses:\n  - provider: quote-api\n    method: GET\n    path: /quotes/{id}\n    sends: []\n    reads: [quoteId, status]\n"
}
```

Example PowerShell upload:

```powershell
$body = @{
  content = @"
consumer: checkout
team: Commerce
uses:
  - provider: quote-api
    method: GET
    path: /quotes/{id}
    sends: []
    reads: [quoteId, status]
"@
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3001/api/consumers" `
  -ContentType "application/json" `
  -Body $body
```

### Analyze

```http
POST /api/analyze
Content-Type: application/json

{}
```

The response includes `created`, a per-provider report, `totals` with finding
and impact counts, and `notifications` with attempted/delivered/failed counts.
With the starter kit, the engine comparison emits 20 findings: 11 `BREAKING`
and 9 `INFO`. Import lint findings are additional.

Analysis preserves existing engine finding IDs and `notified` state when the
same change is found again. New BREAKING findings are posted to
`{WEBHOOK_BASE}/contract-guard`; successful 2xx responses are marked notified.
Failed deliveries are logged, included in the response count, and remain
pending without interrupting analysis.

Example notification body received by the starter-kit receiver:

```json
{
  "event": "contract.breaking_change",
  "findingId": "finding-id",
  "provider": "quote-api",
  "fromVersion": "1.1.0",
  "toVersion": "2.0.0",
  "severity": "BREAKING",
  "affectedApiPath": "POST /quotes",
  "findingPath": "premium.breakdown[].amount",
  "explanation": "POST /quotes: response field 'premium.breakdown[].amount' was renamed to 'premium.breakdown[].value' in 2.0.0. Consumers reading 'premium.breakdown[].amount' will break.",
  "affectedConsumers": ["mobile-app"]
}
```

`POST /api/notifications/retry` explicitly retries all pending BREAKING
findings:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3001/api/notifications/retry" `
  -ContentType "application/json" `
  -Body "{}"
```

Example response:

```json
{
  "attempted": 1,
  "delivered": 1,
  "failed": 0,
  "failures": []
}
```

Repeated analysis does not resend a successfully marked finding. Receiver
failures stay pending and are retried by a later analysis or this endpoint.
Exactly-once delivery across a process crash after receiver acceptance but
before SQLite records success is not guaranteed because the receiver has no
idempotency support.

### Read consumer impacts

```http
GET /api/impacts
```

Response shape:

```json
{
  "findings": [
    {
      "id": "finding-id",
      "provider": "quote-api",
      "fromVersion": "1.1.0",
      "toVersion": "2.0.0",
      "severity": "BREAKING",
      "rule": "response-field-renamed",
      "path": "premium.breakdown[].amount",
      "message": "Response field changed ...",
      "affectedConsumers": ["mobile-app"]
    }
  ]
}
```

The id and message above are illustrative. `GET /api/findings` returns stored
finding rows directly; neither endpoint currently supports filters.

### Check a release

Prefer `publishOrder` because a provider may republish the same version string:

```http
POST /api/gate-check
Content-Type: application/json

{
  "provider": "quote-api",
  "publishOrder": 3
}
```

Verified response for quote-api order 3:

```json
{
  "decision": "BLOCKED",
  "result": "block",
  "blocked": true,
  "provider": "quote-api",
  "publishOrder": 3,
  "version": "2.0.0",
  "affectedConsumers": ["mobile-app"],
  "breakingFields": ["premium.breakdown[].amount"],
  "explanation": "Publishing is blocked because mobile-app would be affected.",
  "warnings": [
    {
      "rule": "request-param-required-added",
      "path": "DELETE /internal/pricing-cache · query param 'region'",
      "message": "DELETE /internal/pricing-cache: new required query parameter 'region' in 2.0.0 (x-internal endpoint — internal contract change, not consumer-facing). Callers that do not send it will fail."
    }
  ]
}
```

Quote-api order 4 (`2.1.0`) was verified to return `decision: "ALLOWED"` and
`result: "allow"`.

You may also supply `"version": "2.0.0"` or `"targetVersion": "2.0.0"`. If
the version string is duplicated, the endpoint responds with an ambiguity error
and asks for `publishOrder`. A missing provider/version, invalid order or
invalid target spec returns an HTTP error. Run `POST /api/analyze` after
importing new data before checking a release: the gate reads stored findings
and does not run analysis itself.

## Database and Prisma commands

Run these from `app/server`:

| Command | Purpose |
| --- | --- |
| `npm run db:generate` | Generate Prisma Client from the schema. |
| `npm run db:deploy` | Apply committed migrations non-interactively. |
| `npm run db:migrate` | Run Prisma's development migration workflow. |
| `npm run db:studio` | Open Prisma Studio. |
| `npm run db:smoke` | Run the database schema smoke script. |

Docker applies migrations automatically at startup and stores data in the
`guard-data` volume. Local runtime defaults to `app/server/prisma/dev.db`.
Prisma CLI operations need a valid `DATABASE_URL`.

## Local development commands

Backend, from `app/server`:

```powershell
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

Frontend, from `app/web`:

```powershell
npm ci
npm run dev
```

Available package scripts also include:

- Server: `npm run build`, `npm run typecheck`, `npm run test`,
  `npm run test:m3`, `npm run test:m4`.
- Web: `npm run build`, `npm run typecheck`, `npm run preview`.

## Tests

Run from `app/server`:

```powershell
npm ci
npm run test
npm run typecheck
npm run build
```

`npm run test` runs the M2 engine suite against the actual kit specifications;
it does not require the database. `npm run test:m3` runs the integration
checks against the database, imports the original kit and runs analysis twice.
`npm run test:m4` also requires the database; it creates and removes uniquely
named fixture records and runs an in-process HTTP receiver. Use a development
database because the M3 test updates imported records and findings.

Current verified results: M2 29/29 checks pass; M3 real-kit checks and M4
webhook delivery/retry checks pass. Server type-check and build pass. The
frontend build was not verified in the latest session because its dependencies
were not installed (`tsc` was unavailable); run `npm ci` in `app/web` before
validating it.

## Troubleshooting

- **`prisma` or `tsx` is not recognized:** run `npm ci` in `app/server`, then
  `npm run db:generate`.
- **`DATABASE_URL` missing / Prisma cannot open SQLite:** set it for the
  server process or Prisma CLI, for example `DATABASE_URL="file:./dev.db"`
  in `app/server/.env`. Check that the selected directory is writable.
- **Prisma schema/client mismatch:** run `npm run db:generate` after schema
  changes; apply existing migrations with `npm run db:deploy`.
- **Port 3001 or 5173 is occupied:** stop the other process or change the
  relevant local `PORT`/Vite configuration. For receiver port conflicts, set
  `WEBHOOK_PORT` before Compose startup.
- **Health is `degraded`:** check its `database` and `webhookReceiver` fields.
  The default local receiver URL is `http://localhost:9900`; start the receiver
  or set `WEBHOOK_BASE` to its actual base URL.
- **Kit import cannot find specs/consumers:** run from the project layout with
  the starter-kit folders present, or set `KIT_SPECS_DIR` and
  `KIT_CONSUMERS_DIR`; Docker Compose mounts them under `/kit`.
- **Gate says allowed after an upload:** run analysis after import. The gate
  currently reads stored findings rather than analyzing the target itself.

## Screenshots

The dashboard is future work; no project dashboard screenshots are available
yet. Add screenshots here after the M5 screens are implemented and verified.
