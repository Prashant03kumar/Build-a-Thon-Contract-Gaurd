# Contract Guard

Contract Guard helps teams understand the effect of API changes before a release. It imports OpenAPI specifications and consumer manifests, compares published versions, identifies affected consumers, checks a publishing gate, and sends breaking-change notifications to a webhook receiver.

The dashboard and API use real data stored in SQLite. The original starter kit remains outside this application directory and is mounted read-only for import.

## Quick start

**Requirements:** Docker Desktop (or Docker Engine) with Docker Compose, and free ports `3001` and `9900`.

From the repository root:

```sh
cd app
docker compose up -d --build
```

Wait for startup and database migrations, then open:

| Address | Purpose |
| --- | --- |
| [localhost:3001](http://localhost:3001) | Dashboard and API |
| [localhost:3001/api/health](http://localhost:3001/api/health) | Database and receiver health |
| [localhost:9900](http://localhost:9900) | Webhook receiver inbox |

Stop the application with `docker compose down` from `app/`. The SQLite volume is retained, so imported data and findings survive a restart. The starter-kit receiver keeps its inbox in memory, so its messages do not survive a receiver restart.

> **Data safety:** `docker compose down -v` also deletes the `guard-data` volume and its database. Use it only when you intentionally want to discard the application's stored data.

## Demonstration

1. Open the dashboard and receiver in separate tabs. On an empty database, select **Import kit**. The kit contains 3 providers, 12 specification versions, 4 consumers and 10 consumer usages. Import records a spec error for a dangling reference and a warning for a republished version.
2. Select **Run analyze**. This compares valid versions, calculates consumer impacts, and attempts to deliver pending breaking-change notifications. A fresh kit analysis produces 11 BREAKING and 9 INFO findings, in addition to the 2 import findings.
3. Explore the findings and affected consumers. For example, `mobile-app` reads the renamed quote field and `partner-portal` is affected by policy request changes. The internal quote cache change is not attributed to an external consumer.
4. Inspect the gate cards and version list. After analysis, the latest claims and policy versions are BLOCKED; the latest quote version is ALLOWED. Quote 2.0.0 is BLOCKED, while its cosmetic 1.0.0 → 1.1.0 reorganization produces no comparison findings.
5. Open the receiver to see the breaking-change events. **Clear receiver** clears its inbox; **Resend notifications** intentionally sends all breaking findings again. Ordinary retries only send pending notifications.

Run analysis after importing or changing data before relying on gate results: the gate uses the findings and impacts already stored in the database. On an existing database, a repeat analysis may report zero *new* findings and zero notifications attempted because existing records and delivery status are retained.

## How it works

1. **Import:** the importer discovers provider YAML files and consumer manifests. Swagger Parser validates and dereferences the specifications. Invalid specifications remain stored and are reported as findings.
2. **Compare:** versions are ordered by `publishOrder`; invalid versions are skipped and comparison bridges to the next valid version. The engine compares normalized operations and request/response schemas.
3. **Assess impact:** findings are matched to consumer operations and their declared fields. Internal operations are excluded from consumer attribution.
4. **Gate and notify:** the gate blocks a version when a BREAKING finding affects a registered consumer. Analysis attempts a webhook POST for each pending BREAKING finding; successful deliveries are recorded.

The dashboard shows these results; it does not itself publish an API. See [DESIGN.md](DESIGN.md) for architecture and limitations, [PLAN.md](PLAN.md) for scope, and [PROGRESS.md](PROGRESS.md) for recorded verification.

## API reference

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | API, database and receiver status |
| `POST /api/kit/import` | Import starter-kit specs and consumer manifests |
| `POST /api/providers/:name/specs` | Upload a spec as JSON: `{ "fileName": "1-initial.yaml", "content": "<YAML>" }` |
| `POST /api/consumers` | Upload a manifest as JSON: `{ "content": "<YAML>" }` |
| `GET /api/providers` | List providers and ordered versions |
| `GET /api/consumers` | List consumers and declared usages |
| `GET /api/findings` | List findings, including delivery flags |
| `GET /api/impacts` | List findings with affected consumers |
| `POST /api/analyze` | Compare versions, update impacts and attempt pending notifications |
| `POST /api/gate-check` | Check `{ "provider": "quote-api", "publishOrder": 3 }` |
| `POST /api/publish/check` | Alias for the gate check |
| `POST /api/notifications/retry` | Retry pending deliveries; `{ "resendAll": true }` deliberately sends all BREAKING findings |
| `POST /api/notifications/clear-receiver` | Clear the configured receiver's inbox; does not reset database delivery flags |

Use `publishOrder` for gate requests when version strings are repeated: claims-api publishes `1.1.0` twice. A version-only request for an ambiguous version is rejected.

## Local development and tests

Requires Node.js 20 or later and npm. The following commands assume terminals start at the repository root. For local webhook delivery, run the receiver separately (for example, from `app/`: `docker compose up -d webhook-receiver`). Ensure `app/server/.env` exists with the following setting; if you already have one, preserve your existing configuration:

```dotenv
DATABASE_URL="file:./dev.db"
```

```sh
cd app/server
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

In another terminal:

```sh
cd app/web
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173). The Vite development server proxies `/api` to port `3001`. The local API defaults to `WEBHOOK_BASE=http://localhost:9900`. The example `.env` uses `app/server/prisma/dev.db`; Prisma client generation is required before a fresh TypeScript build. If the Docker API is already running on port 3001, stop it before starting the local API.

To check the server and web builds:

```sh
cd app/server
npm run typecheck
npm run build
npm run test
npm run test:m3
npm run test:m4
```

```sh
cd app/web
npm run typecheck
npm run build
```

**Test data warning:** the M3 and M4 tests use the configured database, import or create records, run analysis, and may attempt webhook delivery. Use an isolated test database and receiver when you need to preserve existing data. The intentional HTTP 503 in the M4 test exercises its failure path.

## Known limitations

- Findings and gate queries identify target versions by version string, so repeated version strings can cause findings to appear against both publish slots even when a gate request uses `publishOrder`.
- The comparison engine handles the implemented rule set, not every possible OpenAPI compatibility change. Sunset and early-removal rules are not implemented.
- Only BREAKING findings are delivered as webhooks. A successful delivery flag records an HTTP success, not long-term receiver retention. Explicit resend-all may create duplicate receiver events.
- The receiver URL in Docker health data is an internal container address; open [localhost:9900](http://localhost:9900) directly from your browser if the dashboard link does not work.
