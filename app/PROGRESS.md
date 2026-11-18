# Contract Guard — Progress and Verification

## Current status

The application implements the M0–M6 demo workflow: import, validation, comparison, impact mapping, advisory gate, webhook delivery and dashboard. See [PLAN.md](PLAN.md) for the acceptance targets and [DESIGN.md](DESIGN.md) for implementation details and boundaries.

| Milestone | Implemented scope |
| --- | --- |
| M0 | API and UI scaffold, Compose and health endpoint |
| M1 | SQLite registry, starter-kit import, validation and import findings |
| M2 | Version comparison, targeted rules and invalid-version bridging |
| M3 | Consumer attribution and publish gate |
| M4 | Webhook delivery and pending retry |
| M5 | Responsive, API-backed dashboard |
| M6 | Demo workflow checks, lifecycle checks and documentation |

## Recorded verification

The following results were observed during the previous M5/M6 verification on 2026-11-18. They are historical results, not a claim that tests were rerun for this documentation update.

| Check | Recorded result |
| --- | --- |
| Backend TypeScript typecheck and build | Passed after generating the Prisma client |
| Frontend TypeScript typecheck and production build | Passed |
| Engine suite | Passed; kit B1–B6 detected and quote cosmetic reorganization produced zero findings |
| M3 suite | Passed; 22 findings and 5 consumer-impact links in the observed kit database |
| M4 suite | Passed; delivery, expected HTTP 503 failure path, retry and duplicate prevention exercised |
| Compose lifecycle | Startup and shutdown worked; a normal restart preserved 12 versions and 22 findings |

### Fresh-database workflow observations

The recorded Docker workflow started with empty tables. Import returned 3 providers, 12 versions, 4 consumers, 10 usages and 2 import findings. Analysis created 20 comparison findings, recorded 5 impacts and delivered 11 notifications. Re-analysis created no new findings and attempted no repeat deliveries. The latest claims and policy gates were BLOCKED and the latest quote gate was ALLOWED. The internal quote change had no external consumer attribution.

The initial workflow script **failed** its expectation that ordinary retry would resend notifications after clearing the receiver. A separate check using the explicit `resendAll` option subsequently delivered 11 events; an ordinary retry then attempted zero. The original workflow was not recorded as a clean 14/14 pass, and the temporary workflow script is not a committed automated test.

## Known limitations

- Findings and gate checks use version strings for target matching; a republished version string can conflate results across publish slots.
- Sunset and early-removal deadline rules from the original plan are not implemented. The comparison engine covers selected rules, not all OpenAPI compatibility changes.
- Only BREAKING findings trigger webhook delivery. A receiver restart clears its in-memory inbox, while successful delivery flags remain in SQLite; explicit resend-all can refill it but can also duplicate events.
- Impact mapping depends on declared manifests and operation information extracted from finding text. Gate decisions depend on the latest stored analysis.
- The application is a demo, not a hardened production service; it has no documented authentication or durable webhook queue.

For setup, non-destructive shutdown, test commands and the demo walkthrough, see [README.md](README.md).
