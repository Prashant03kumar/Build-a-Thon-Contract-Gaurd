# Contract Guard — Build Plan

> Acko SDE Buildathon · API contract registry & breaking-change guard
> Status: plan approved for implementation · Starter-kit files (`specs/`, `consumers/`, `webhook-receiver/`, `docker-compose.yml`) remain untouched.

---

## 1. What Contract Guard Is & The Problem We Solve

**Contract Guard** is an API contract registry that watches how provider APIs evolve and warns teams **before** a new API version is published that would break the services consuming it.

Insurance platforms run on many small services calling each other's REST APIs. Each provider team version their OpenAPI spec independently; each consumer team codes against whichever fields they need. Nobody owns the _space between_ the two — so a provider can rename a response field or make a request field mandatory, and consumers only find out in production.

**The problem, concretely (from the starter kit):** if the Quotes team publishes v2.0.0, the mobile app's `premium.breakdown[].amount` read silently becomes `undefined`. Contract Guard turns that surprise into an alert at publish time.

**What it does:**

1. Ingests OpenAPI specs (per provider, ordered versions) and consumer dependency manifests.
2. Validates specs and diffs consecutive versions.
3. Detects breaking changes, deprecations, sunset violations and spec errors.
4. Maps every finding to the consumers it hurts.
5. Alerts via the starter-kit webhook receiver and exposes findings in a dashboard.
6. Provides a publish gate: allow / block a version before release.

---

## 2. Who Uses It & Why

| User                                                             | What they do with it                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Provider team (Quotes / Policy / Claims)**                     | Uploads a new spec version before publishing; checks the gate verdict — "block" means fix or migrate consumers first.      |
| **Consumer team (Mobile / Partners / Payments / Notifications)** | Looks up "what do I call, what can break me", gets notified when a version they depend on changes.                         |
| **Platform / API governance lead**                               | Single dashboard of all providers, versions and open breakages; drives sunset deadlines (`x-sunset`) to zero legacy usage. |
| **Evaluator (buildathon)**                                       | Imports the kit folder, runs analyze, sees the known breakages found and alerted.                                          |

Core value: **shift breakage discovery from production to publish time.**

---

## 3. Features

### 3.1 Required (MVP — buildathon scope)

| #   | Feature                                                                                    | Acceptance                                                                       |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| F1  | Import specs: one-click kit-folder import + `POST` upload API                              | All 12 specs + 4 consumer files ingested                                         |
| F2  | Spec validation incl. `$ref` resolution; invalid specs stored, flagged, never crash ingest | Claims `ClaimDocumnt` dangling ref → SPEC-ERROR finding                          |
| F3  | Version lineage by publish order; same-version republish handled                           | Claims 1.1.0 twice → both stored, WARN raised                                    |
| F4  | Consecutive-version diff with the MVP rule set (§8)                                        | All planted breakages (B1–B6) detected — 5 consumer-facing + 1 provider-internal |
| F5  | Consumer impact mapping (sends/reads vs. changed contract)                                 | Impact matrix names mobile-app, payments-svc, partner-portal                     |
| F6  | `x-internal` scope filter + deprecation / `x-sunset` checks                                | Internal cache change not blamed on consumers; `phone` early removal flagged     |
| F7  | Webhook notifications to the starter-kit receiver, one POST per finding                    | Receiver page + `GET /api/received` shows alerts                                 |
| F8  | Dashboard: findings, severity badges, version timeline, impact matrix                      | Live after analyze                                                               |
| F9  | Publish gate endpoint: `allow / block` verdict per provider version                        | Blocks v2.0.0 quote publish (consumer affected)                                  |
| F10 | Idempotent re-analyze (safe to re-run after new uploads)                                   | Re-analyze produces no duplicates                                                |

### 3.2 Additional (stretch — only if time permits)

- Ack / resolve findings (mark "migration in progress", assign owner)
- CSV / JSON export of the findings report
- Side-by-side spec viewer or simple visual diff
- Sunset countdown cards ("phone removed 3 days before its 2027-06-30 sunset")
- Consumer manifest editor in the UI
- Filters, search, per-team email digest mock
- Demo script / seed reset button (clear receiver + re-import)

---

## 4. Starter-Kit Findings (ground truth we build against)

### 4.1 Three provider APIs × four versions each (12 OpenAPI 3.0.3 files)

| Provider                   | Versions (publish order 1→4)                | Endpoints                                                                             |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `quote-api` (Quotes team)  | 1.0.0 → 1.1.0 → 2.0.0 → 2.1.0               | `POST /quotes`, `GET /quotes/{id}`, `DELETE /internal/pricing-cache` (`x-internal`)   |
| `policy-api` (Policy team) | 1.0.0 → 1.1.0 → 2.0.0 → 2.1.0               | `GET /policies`, `GET /policies/{policyId}`, `POST /policies/{policyId}/endorsements` |
| `claims-api` (Claims team) | 1.0.0 → 1.1.0 → 1.1.0 (republished) → 2.0.0 | `POST /claims`, `GET /claims/{claimId}`                                               |

### 4.2 Four consumers (10 API usages total)

| Consumer            | Team                 | Calls                                                                                       |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `mobile-app`        | Mobile               | quote `POST /quotes`, `GET /quotes/{id}`; claims `POST /claims`, `GET /claims/{claimId}`    |
| `partner-portal`    | Partner Integrations | quote `POST /quotes`; policy `POST /policies/{policyId}/endorsements`                       |
| `payments-svc`      | Payments             | policy `GET /policies/{policyId}` (reads `legacyCode`)                                      |
| `notifications-svc` | Notifications        | policy `GET /policies/{policyId}`; claims `GET /claims/{claimId}`; quote `GET /quotes/{id}` |

### 4.3 Webhook receiver (the alert sink — `webhook-receiver/app.py`)

- `POST <any path>` → stores body, always `200 {"ok":true,"id":n}`; JSON or text
- `GET /` → live HTML table, auto-refresh 3 s (our demo screen)
- `GET /api/received` → JSON list · `DELETE /api/received` → clear
- Runs at `http://localhost:9900` via `docker compose up --build` (container port 9000)

### 4.4 Intentional breaking changes / traps the kit plants (our test targets)

| #   | Change                                                                                                | Version                  | Victim                         | Expected severity                                 |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------ | ------------------------------------------------- |
| B1  | `premium.breakdown[].amount` renamed → `value`                                                        | quote 2.0.0              | mobile-app                     | BREAKING                                          |
| B2  | `amountApproved` dropped from required (may be absent)                                                | claims 2.0.0             | mobile-app                     | BREAKING                                          |
| B3  | `legacyCode` removed (after sunset passed)                                                            | policy 2.0.0             | payments-svc                   | BREAKING                                          |
| B4  | `requestedBy` now required on endorsement request                                                     | policy 2.1.0             | partner-portal                 | BREAKING                                          |
| B5  | endorsement `type` enum narrowed — `VEHICLE` dropped                                                  | policy 2.1.0             | partner-portal (risk)          | BREAKING                                          |
| B6  | required `region` param on `DELETE /internal/pricing-cache`                                           | quote 2.0.0              | none (`x-internal`)            | BREAKING (provider-internal — no consumer impact) |
| D1  | `legacyCode` `x-sunset: 2026-11-01` (already past)                                                    | policy 1.1.0             | payments-svc warned            | DEPRECATION / SUNSET-EXPIRED                      |
| D2  | `phone` `x-sunset: 2027-06-30` but removed in 2.0.0 — early removal                                   | policy 2.0.0             | provider violation             | EARLY-REMOVAL                                     |
| T1  | Dangling `$ref: ClaimDocumnt` (typo)                                                                  | claims 1.1.0 (file 2)    | —                              | SPEC-ERROR                                        |
| T2  | Same version number republished                                                                       | claims 1.1.0 (files 2→3) | —                              | WARN                                              |
| T3  | Cosmetic reorg: schemas inlined, `Premium`→`PremiumDetails`, `{id}`→`{quoteId}`                       | quote 1.1.0              | must produce **zero findings** | (false-positive test)                             |
| T4  | Additive changes: `EXPIRED` status, `channel`, `assessorNotes`, `taxes`, `ncbPercent`, `202` response | various                  | none                           | INFO                                              |

---

## 5. Technology Stack

| Layer    | Choice                                            | Why                                                        |
| -------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Frontend | React 18 + Vite + TypeScript                      | Fast scaffold, HMR, typed models                           |
| Styling  | Tailwind CSS v4 (`@tailwindcss/vite`)             | One-line setup, no postcss config                          |
| Backend  | Node.js 20 + Express + TypeScript                 | Best-in-class OpenAPI tooling lives here                   |
| Parsing  | `@apidevtools/swagger-parser` (+ `openapi-types`) | Validation, `$ref` dereference, dangling-ref errors        |
| YAML     | `js-yaml`                                         | Consumer manifests + kit-folder import                     |
| Database | SQLite via Prisma                                 | Single-file, zero-ops, typed client                        |
| Notify   | Native `fetch` (Node 18+ built-in)                | No axios, no queue                                         |
| Tests    | Vitest                                            | Rule unit tests + golden-path test                         |
| Runtime  | Docker Compose (2 containers)                     | `guard` (serves API + built UI) + kit's `webhook-receiver` |

Deliberately excluded: axios (use `fetch`), cors (Vite dev proxy / same-origin prod), deep-diff libs (generic diffs fail the kit's traps), queues, Postgres, WebSockets.

---

## 6. How Frontend, Backend & Database Work Together

```
Browser (React SPA)
   │  fetch /api/*  (dev: Vite proxy → :3001; prod: same-origin static)
   ▼
Express API  ──► engine pipeline ──► findings
   │                 │
   │                 ├─ swagger-parser: validate + dereference
   │                 ├─ normalizer: canonical operation model
   │                 ├─ rules: diff findings      ├─ impact: consumer join
   │                 └─ notify: POST each finding → webhook-receiver :9000
   ▼
Prisma client ──► SQLite file (guard.db)
```

- Frontend never touches the engine or DB — only the REST API (8 endpoints).
- Analysis runs **after every ingest** (idempotent, per provider) + manual "Re-analyze" button.
- In prod one container serves both API and built UI (multi-stage Dockerfile).
- Compose env: `WEBHOOK_URL=http://webhook-receiver:9000/contract-guard`, `DATABASE_URL=file:/data/guard.db`, `KIT_DATA_DIR=/kit` (specs/consumers mounted read-only).

**API surface (8 endpoints):**

| Method & path                                | Purpose                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `POST /api/kit/import`                       | Import all specs + consumers from the kit folder         |
| `POST /api/providers/:name/specs`            | Upload one spec version (multipart/JSON)                 |
| `GET /api/providers`                         | Providers + versions + validity                          |
| `POST /api/consumers` / `GET /api/consumers` | Upload / list consumer manifests                         |
| `POST /api/analyze`                          | Re-run pipeline, returns findings                        |
| `GET /api/findings`                          | Findings (filter by provider/severity/consumer)          |
| `POST /api/gate-check`                       | Publish gate verdict `{provider, version}` → allow/block |
| `GET /api/health`                            | Liveness + receiver reachability                         |

---

## 7. Database Design (Prisma + SQLite)

Five tables. JSON payloads are stored as `String` columns (Prisma `Json` is unsupported on SQLite).

```
Provider      id, name (unique)                         ──< SpecVersion
SpecVersion   id, providerId, version, publishOrder,    publishOrder = lineage key
              fileName, valid, raw, canonical(JSON str)  unique(providerId, publishOrder)
Consumer      id, name (unique), team                   ──< ConsumerUse
ConsumerUse   id, consumerId, providerName, method,
              pathRaw, pathNorm, sendsJson, readsJson
Finding       id, provider, fromVersion?, toVersion?,
              consumer?, severity, rule, path, message,
              notified, createdAt            index(severity, provider)
```

Key decisions:

1. **`publishOrder`, not `version`, is the lineage key** — claims-api republished `1.1.0`; a `(providerId, version)` unique key would reject the corrected republish.
2. **Store the dereferenced canonical model per version** — analysis is re-runnable without re-parsing.
3. **Join consumers by `providerName + method + pathNorm`** — path params normalized to `{param}` so consumer `/quotes/{id}` matches spec `/quotes/{quoteId}` (README: "specs may have moved on").
4. **`Finding.notified` flag** — receiver down ⇒ nothing lost; retried on next analyze.

---

## 8. Validation, `$ref` Resolution, Version Comparison, Breaking-Change Detection

### 8.1 Pipeline per spec version

```
parse (yaml) → validate (swagger-parser, try/catch) → dereference ($refs inlined)
            → normalize (canonical operation model)
```

- All kit refs are internal (`#/components/schemas/...`) — easy case, fully handled by swagger-parser.
- Invalid spec (dangling ref) ⇒ SPEC-ERROR finding, version stored with `valid=false`, pipeline continues; deep diffs _skip from_ that version (claims: diff 1→3 and 3→4).
- Normalizer keys operations by `operationId` + method + normalized path template and strips component names — this is what kills the quote 1→2 cosmetic-reorg false positives (T3).

### 8.2 MVP rule set (each rule: `(prev, next, side) => Finding[]`)

| Rule                                                             | Side     | Severity                                                                                               |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Response field removed                                           | response | BREAKING                                                                                               |
| Response field demoted required→optional                         | response | BREAKING                                                                                               |
| Response field renamed (remove+add same type)                    | response | BREAKING                                                                                               |
| Request field now required                                       | request  | BREAKING                                                                                               |
| Request enum narrowed                                            | request  | BREAKING                                                                                               |
| Required request param added                                     | request  | BREAKING (tagged provider-internal when the operation is `x-internal: true` — no consumer attribution) |
| Response enum widened / optional field added / new response code | either   | INFO                                                                                                   |
| `deprecated: true` + `x-sunset` (past/future vs today)           | —        | SUNSET-EXPIRED / DEPRECATION                                                                           |
| Removed field whose `x-sunset` is in the future                  | —        | EARLY-REMOVAL                                                                                          |
| Dangling `$ref` / unresolvable spec                              | —        | SPEC-ERROR                                                                                             |
| Same `info.version` republished                                  | —        | WARN                                                                                                   |

Rules are pure functions over the canonical model — unit-tested against kit fixtures on **both request and response sides** (direction matters: enum widened is safe on responses, narrowing on requests is breaking).

### 8.3 Affected-service identification & publish prevention

- For every finding, join all `ConsumerUse` rows on `providerName + method + pathNorm`.
  - `sends` fields checked against the new request contract (B4/B5 hit partner-portal).
  - `reads` fields checked against the new response contract (B1 hits mobile-app, B3 hits payments-svc).
- `x-internal: true` operations are excluded from consumer attribution (B6 stays provider-level).
- **Publish gate:** `POST /api/gate-check {provider, version}` →
  `block` if any open BREAKING finding with a named consumer exists for the previous→new pair, `warn` for provider-level/sunset findings, `allow` otherwise. The response lists the exact consumers and fields to fix — actionable, not just a red light. A CI pipeline can call the same endpoint.

---

## 9. Planned Screens (4 + shared shell)

1. **Dashboard** — provider cards with version counts, severity summary, findings feed; "Import kit" + "Analyze" actions.
2. **Provider detail** — version timeline (publish order), per-pair findings list with rule/severity/field path, consumer impact chips.
3. **Consumers** — consumer cards (team, calls); impact matrix rows = consumers × providers, cell = affected fields or ✓.
4. **Findings** — filterable table (severity, provider, consumer, rule) with webhook-delivery badge.
5. _(Stretch)_ **Gate / report** — simulate a publish, show verdict, export findings.

Design: Tailwind, severity color language (red BREAKING, amber DEPRECATION/SUNSET, violet EARLY-REMOVAL, blue SPEC-ERROR, grey INFO), polling every 3–5 s to match the receiver's live page.

---

## 10. Testing Strategy (kit data = fixtures)

1. **Unit tests per rule** — mini prev/next spec pairs on both sides.
2. **Golden-path integration test** — import kit → analyze → assert the exact expected set:
   5 consumer-facing BREAKING (B1–B5) + 1 provider-internal BREAKING (B6 — `x-internal` endpoint, no consumer attributed), D1/D2 sunset findings, T1 SPEC-ERROR, T2 WARN, T4 INFO — **and zero findings for quote 1→2 (T3 false-positive check)**.
3. **Impact assertions** — mobile-app ↔ B1+B2; payments-svc ↔ B3; partner-portal ↔ B4(+B5); B6 → provider-level only, **no** consumer attributed.
4. **Gate test** — gate-check on quote 2.0.0 → `block` (mobile-app named); on quote 2.1.0 → `allow`.
5. **Webhook test** — after analyze, `GET :9900/api/received` contains one entry per finding; survive receiver-down (notified=false, retry works).
6. **Robustness** — dangling-ref spec never crashes ingest; re-analyze is idempotent.

---

## 11. Development Roadmap

| #   | Milestone      | Scope                                                                                         | Exit criteria                                                                                | Est.      |
| --- | -------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- |
| 0   | Scaffold       | Monorepo `app/server` + `app/web`, compose with both containers, health endpoints, Vite proxy | `docker compose up` → UI loads, health green                                                 | 30–45 m   |
| 1   | Ingest & store | Prisma schema+migration, kit-folder import, upload API, lint (T1/T2)                          | All 12 specs + 4 consumers in DB; SPEC-ERROR + WARN visible                                  | 1.5–2 h   |
| 2   | Diff engine    | Normalizer, pair-diff by publishOrder, MVP rules                                              | B1–B6 detected (5 consumer-facing + 1 provider-internal); quote 1→2 zero-findings test green | 2–3 h     |
| 3   | Impact & gate  | Consumer join, x-internal filter, sunset rules, gate endpoint                                 | Impact matrix correct; gate blocks quote 2.0.0                                               | 1–1.5 h   |
| 4   | Notifications  | Per-finding POST to receiver, notified flag + retry                                           | Live receiver page fills on analyze                                                          | 45–60 m   |
| 5   | UI             | 4 screens, Tailwind severity language, polling                                                | Full demo: publish v2.0.0 → alerts on receiver + dashboard                                   | 1.5–2 h   |
| 6   | Harden & demo  | Golden test suite, README, demo script, stretch picks                                         | Clean run from `docker compose up --build`                                                   | remaining |

**Demo flow (final):** fresh compose up → Import kit → Analyze → walk the findings → show receiver page filling → gate-check quote 2.0.0 = block with mobile-app named.

---

## 12. Risks & Mitigations

| Risk                                                            | Kit trap    | Mitigation                                                              |
| --------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| Generic deep-diff false positives (component renames, inlining) | T3          | Dereference + normalize before diff; zero-finding acceptance test       |
| Directionality errors (safe on response, breaking on request)   | T4          | `side` parameter in every rule; both-side unit tests                    |
| Crash on invalid spec                                           | T1          | try/catch → SPEC-ERROR; skip deep diffs from invalid version            |
| Same-version republish rejected/overwritten                     | T2          | `publishOrder` lineage key + WARN                                       |
| Prisma/SQLite gotchas (`Json` type, generate step in Docker)    | —           | JSON-in-String columns; generate in Dockerfile; node:20-slim            |
| Path-param drift between consumers and specs                    | README note | Method + normalized path template as join key                           |
| Sunset logic conflation (legal removal vs early removal)        | D1/D2       | Two distinct rules evaluated against today's date (injected for tests)  |
| Internal endpoint blamed on consumers                           | B6          | `x-internal` filter in impact join                                      |
| Scope creep / time pressure                                     | —           | MVP = F1–F10 only; stretch list gated on time; every milestone demoable |

---

## 13. Expected Outcomes (success criteria)

1. One command (`docker compose up --build`) starts everything; kit files untouched.
2. Import + analyze of the kit finds **all planted problems**: 6 breaking changes — 5 consumer-facing (B1–B5) + 1 provider-internal (B6) — both sunset violations (incl. early removal of `phone`), the dangling ref, the republish warning — with **no false positives** on the cosmetic reorg.
3. Every consumer-affecting finding names the affected service and field (mobile-app, payments-svc, partner-portal).
4. Alerts appear on the starter-kit webhook receiver page in real time and via `GET /api/received`.
5. The publish gate blocks an unsafe version and states exactly which consumers and fields would break.
6. The pipeline is idempotent, resilient to invalid specs, and covered by a golden-path test suite.

---

_Prepared from direct inspection of the starter kit: 12 spec files, 4 consumer manifests, webhook receiver source, README and docker-compose. No starter-kit file was modified._
