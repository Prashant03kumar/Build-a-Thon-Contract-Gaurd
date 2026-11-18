# Contract Guard — Development Progress

## Current stage

M0–M3 are implemented. M3 has been verified against the starter-kit data and
the publishing-check route. M4 notifications and M5 dashboard screens are
pending. M6 documentation is in progress; the clean Compose/demo verification
and other hardening remain outstanding. The app is a buildathon MVP, not a
production release gate.

## Milestone status

### M0 — Scaffold: completed

- **Implemented:** Express API, React/Vite frontend, Docker Compose runtime and
  health endpoint.
- **Important files:** `app/server/src/index.ts`,
  `app/server/src/routes/health.ts`, `app/server/Dockerfile`,
  `app/web/src/App.tsx`, `app/compose.yaml`.
- **Evidence:** source includes the Express listener and health check; Compose
  defines the guard and webhook receiver services.
- **Remaining:** no M0-specific automated test is configured.

### M1 — Database and ingestion: completed

- **Implemented:** Prisma/SQLite models and migrations; kit-folder import;
  individual spec and consumer upload routes; OpenAPI validation and
  `$ref` resolution; invalid spec and duplicate-version lint findings.
- **Important files:** `app/server/prisma/schema.prisma`,
  `app/server/prisma/migrations/`, `app/server/src/ingest/`,
  `app/server/src/routes/import.ts`, `app/server/src/routes/catalog.ts`.
- **Evidence:** the actual kit contains 12 specs and 4 consumer manifests;
  M3's integration run imports these records, including the invalid claims
  spec and duplicate version case.
- **Remaining:** add focused tests for import errors and synchronization
  edge cases if the ingest contract is extended.

### M2 — Version comparison: completed

- **Implemented:** normalized operation maps, consecutive valid-version
  comparisons by publish order, breaking/informational rules and idempotent
  finding recomputation.
- **Important files:** `app/server/src/engine/normalize.ts`,
  `app/server/src/engine/diff.ts`, `app/server/src/routes/analyze.ts`,
  `app/server/src/engine/engine.test.ts`.
- **Evidence:** `npm run test` in `app/server` passed all 29 checks in the
  current verification run. The real kit yielded 11 `BREAKING` and 9 `INFO`
  engine findings (20 total), with zero findings for the cosmetic quote
  version reorganization.
- **Remaining:** planned sunset/deprecation/early-removal rules and broader
  comparison cases remain unimplemented.

### M3 — Consumer impact and publishing gate: completed

- **Implemented:** provider/method/normalized-path consumer matching,
  per-finding many-to-many impact rows, `x-internal` exclusion, impact
  retrieval, and release verdicts with affected consumers and explanations.
- **Important files:** `app/server/prisma/schema.prisma`,
  `app/server/prisma/migrations/20261118180000_finding_consumer/migration.sql`,
  `app/server/src/engine/impact.ts`,
  `app/server/src/routes/impact.ts`,
  `app/server/src/routes/publish.ts`,
  `app/server/src/m3.test.ts`.
- **Evidence:** `npm run test:m3` passed against the actual kit. It reported
  `firstAnalysisCreated: 20`, `secondAnalysisCreated: 20`,
  `findingCount: 22` and `impactCount: 5`; assertions verified B1/mobile-app,
  B3/payments-svc, B4/B5/partner-portal, B6 without external attribution,
  unrelated notifications consumer exclusion and repeat-analysis behavior.
  Live HTTP checks returned `BLOCKED` for quote-api publish order 3
  (`mobile-app` affected) and `ALLOWED` for order 4. Server type-check and
  build passed during M3 verification.
- **Remaining/limitations:** `test:m3` checks the database state, not the
  Express HTTP error paths. Gate finding lookup uses the version string after
  selecting a publish order; duplicate version strings can conflate findings.
  The gate assumes analysis was run first. See [DESIGN.md](./DESIGN.md).

### M4 — Notifications: pending

- **Implemented:** none of the planned finding-delivery workflow.
- **Important files:** `Finding.notified` exists in
  `app/server/prisma/schema.prisma`; `app/server/src/routes/health.ts` checks
  receiver reachability only.
- **Evidence:** no notification route/worker or analysis-to-receiver POST is
  wired into the current source.
- **Remaining:** implement per-finding webhook delivery, update `notified`,
  and cover receiver-down/retry behavior as specified in `PLAN.md`.

### M5 — Dashboard: pending

- **Implemented:** a scaffold page showing API and webhook health.
- **Important files:** `app/web/src/App.tsx`,
  `app/web/src/api/client.ts`, `app/web/src/index.css`.
- **Evidence:** the page only polls `/api/health`; it does not display
  providers, versions, findings, impacts or gate results. Frontend type-check
  and build could not be run in this workspace because frontend dependencies
  are not installed (`tsc` was not found).
- **Remaining:** implement the planned dashboard, provider detail, consumers
  and findings views; add UI/API integration and visual validation.

### M6 — Hardening and demo: in progress

- **Implemented:** existing M2 rule suite, M3 real-kit integration checks and
  the root setup/architecture/progress documentation.
- **Important files:** `PLAN.md`, `app/server/src/engine/engine.test.ts`,
  `app/server/src/m3.test.ts`, root `README.md`.
- **Evidence:** M2 tests passed 29/29; M3 integration checks passed. The root
  `README.md`, `DESIGN.md` and `PROGRESS.md` have been created/updated in this
  documentation task.
- **Remaining:** broaden golden-path/API tests; cover the M4 workflow after
  implementation; verify a clean Compose build and demo flow; add operational
  guidance and resolve known gate limitations.

## Verified commands and outcomes

Run commands from the indicated package directory:

| Directory | Command | Verified outcome |
| --- | --- | --- |
| `app/server` | `npm run test` | Pass: all 29 M2 checks; 20 engine findings (11 `BREAKING`, 9 `INFO`). |
| `app/server` | `npm run typecheck` | Pass in the current verification run. |
| `app/server` | `npm run test:m3` | Pass in M3 verification: 22 total findings and 5 impact associations; repeat analysis remained idempotent. |
| `app/server` | `npm run build` | Pass during M3 verification. |
| `app/web` | `npm run typecheck` | Not run successfully here: frontend dependencies were absent and `tsc` was not found. |
| `app/web` | `npm run build` | Not verified here for the same missing dependencies. |

The M3 test imports the original kit and updates the database it is configured
to use; use a development database when running it.

## Known limitations

- Planned `x-sunset`, deprecation and early-removal rules are missing.
- No webhook notifications or retry loop exist yet.
- The frontend is a health page rather than the planned dashboard.
- The gate should require a current analysis and should select findings by
  publish slot, not only a potentially duplicated version string.
- The current test runner is `tsx` plus `node:assert`; Vitest is only in the
  original plan.
- There is no authentication/authorization layer, and broader HTTP error-path
  coverage remains outstanding.

## Recommended next steps

1. Resolve the gate's stale-analysis and duplicate-version selection behavior
   and add endpoint-level tests for success and error responses.
2. Implement M4 webhook notification delivery and retry semantics.
3. Build the planned M5 dashboard using the existing catalog, findings and
   impact APIs.
4. Complete M6 clean Compose/demo verification and document any remaining
   acceptance gaps.
