# Contract Guard — Progress Log

| Milestone | Scope | Status | Proof |
| --- | --- | --- | --- |
| M0 | Scaffold: Express API + React/Vite web + 2-container compose + health endpoint | ✅ Done | health JSON live; UI served same-origin |
| M1a | Prisma + SQLite: 5 tables, migrations, anti-duplicate lineage key, DB-aware health | ✅ Done | `db:smoke` 6/6; unique-slot P2002 proof |
| M1b | Import: 12 specs + 4 consumer manifests, Swagger Parser validation + `$ref` dereference, lint (dangling ref SPEC_ERROR, republish WARN), idempotent re-imports | ✅ Done | 3/12/4/10 rows + 2 lint findings; run-twice identical |
| M2 | Diff engine: normalize → bridge invalid specs → direction-aware rules; `POST /api/analyze` | ✅ Done | `npm run test` 29/29; B1–B6 detected; quote 1→2 zero false positives |
| M3 | Consumer impact join + `FindingConsumer` model + `GET /api/impacts` + `POST /api/gate-check` (ALLOWED/BLOCKED + who breaks) | ✅ Done | `npm run test:m3` passed; B6 never attributed; notifications-svc untouched |
| M4 | Webhook delivery: BREAKING findings POSTed to the kit receiver, `notified` flag, retry endpoint, duplicate prevention, failure tolerance | ✅ Done | `npm run test:m4` passed; 11/11 delivered live; receiver holds 11 events |
| M5 | Dashboard: overview cards, provider/version timeline with gate badges, findings with affected consumers + delivery status, consumer cards, webhook panel, action buttons — all real data | ✅ Done | web typecheck + build clean; live data verified (see below) |
| M6 | Hardening & demo polish (golden end-to-end script, edge cases, stretch items) | ⏳ Not started | — |

## M5 verification (actual results, 2026-11-18)

- `npm run typecheck` (web): **pass** — zero errors.
- `npm run build` (web): **pass** — 29 modules, Tailwind CSS 14.89 kB, JS 157.89 kB.
- Backend suites re-run after wiring: engine **29/29 PASS**, M3 **PASS** (22 findings / 5 impacts), M4 **PASS** (delivery, failure, retry, no duplicates).
- Live container: overview shows providers 3 · versions 12 · consumers 4 · breaking 11;
  gates — claims v2.0.0 **BLOCKED [mobile-app]**, policy v2.1.0 **BLOCKED [partner-portal]**,
  quote v2.1.0 **ALLOWED**; notifications **11 delivered / 0 failed**;
  webhook receiver holds 11 `contract.breaking_change` events.

## Known honest limitations (say these in evaluation)

- Gate per version uses findings keyed by version *string*; the republished claims
  `1.1.0` slot shows its findings on both rows (count by `toVersion`).
- Only BREAKING findings trigger webhook delivery (INFO stays `notified=false` by design).
- Sunset/`x-sunset` rules (D1/D2) are planned but not yet implemented (M6/stretch).
- Dashboard is one page; deep-dive screens (per-pair diff detail) are stretch.
