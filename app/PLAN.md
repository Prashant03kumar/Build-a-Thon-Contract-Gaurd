# Contract Guard — Project Plan and Scope

This is the application-focused summary of the original [project plan](../PLAN.md), updated to distinguish implemented capabilities from original ambitions. Implementation details are in [DESIGN.md](DESIGN.md); recorded results are in [PROGRESS.md](PROGRESS.md).

## Goal

Help API providers identify potentially breaking contract changes and understand which registered consumers may be affected before publishing. The demonstration uses the supplied OpenAPI specifications, consumer manifests and webhook receiver without modifying them.

## Delivered milestones

| Milestone | Scope |
| --- | --- |
| M0 — Scaffold | React dashboard, Express API, health endpoint and Compose setup |
| M1 — Registry | SQLite/Prisma models, spec and consumer import, validation, dereferencing and import lint |
| M2 — Comparison | Publish-order comparisons, targeted direction-aware compatibility rules and invalid-spec handling |
| M3 — Impact and gate | Consumer matching and an advisory ALLOWED/BLOCKED gate |
| M4 — Notifications | BREAKING webhook delivery, delivery tracking and pending retry |
| M5 — Dashboard | Provider and version list, findings, impact, gate and notification views |
| M6 — Demo readiness | Build and workflow checks, lifecycle verification, documentation and demo controls |

## Starter-kit acceptance targets

| Target | Expected behavior |
| --- | --- |
| B1 | Detect quote response field `premium.breakdown[].amount` renamed to `value` |
| B2 | Detect claims response field `amountApproved` losing its required status |
| B3 | Detect policy response field `legacyCode` being removed |
| B4 | Detect policy request field `requestedBy` becoming required |
| B5 | Detect the policy request enum no longer accepting `VEHICLE` |
| B6 | Detect the required internal `region` parameter without attributing it to an external consumer |
| Validation traps | Report the dangling claims `$ref` and the repeated claims version string |
| Cosmetic reorganization | Quote 1.0.0 → 1.1.0 produces no comparison findings |
| Repeat analysis | Unchanged findings are reconciled without duplicate rows or automatic re-delivery |

The observed kit totals and test evidence are recorded in [PROGRESS.md](PROGRESS.md). These are fixture-specific results, not a promise that every possible API change is detected.

## Remaining boundaries and possible improvements

The original plan included sunset and early-removal rules; these are **not implemented**. Other possible future work includes richer OpenAPI coverage, unambiguous finding-to-version identities, structured operation metadata for impact matching, and production-grade authentication and webhook delivery. These are opportunities, not claims of completed features or a commitment to a further milestone.

## Verification approach

- Engine tests use the actual starter-kit YAML and check B1–B6 and the cosmetic-reorganization case.
- M3 tests exercise consumer attribution and analysis idempotency; M4 tests exercise webhook delivery, failure, retry and duplicate prevention.
- The documented Docker demo exercises import, analysis, impact, gate and receiver together. Refer to [README.md](README.md) for commands and data-safety warnings.
