# Contract Guard — Architecture and Design

## Project overview

Contract Guard is an API contract registry and release-safety check for services
that publish versioned OpenAPI specifications. It stores provider specifications
and consumer usage manifests, compares valid specifications in publish order,
records findings, maps breaking changes to affected consumers, and exposes a
publishing gate.

The starter kit supplies three providers (`quote-api`, `policy-api`,
`claims-api`), four consumers and the webhook receiver. The registry and engine
are implemented in `app/`. The project plan and its full acceptance criteria
remain in [PLAN.md](./PLAN.md).

## Architecture and implementation status

```text
Browser ──► React + Vite (local :5173)
                    │ /api proxy
                    ▼
             Express API (:3001) ──► SQLite via Prisma
                    │
                    ├─ reads starter-kit specs and consumer manifests
                    └─ checks webhook receiver reachability

Docker Compose: Express serves the built React app and accesses the
read-only-mounted kit data; a separate service runs the webhook receiver.
```

**Implemented:** scaffold, SQLite persistence, specification/consumer import,
comparison engine, consumer-impact associations and publishing-check routes.
The deployed UI is still a health-status scaffold. Webhook delivery,
the planned findings/impact dashboard and broader hardening/demo work are not
implemented.

## Technology stack

| Area | Actual implementation |
| --- | --- |
| Backend | Node.js, Express 4, TypeScript |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS v4 |
| Persistence | SQLite and Prisma |
| OpenAPI | `@apidevtools/swagger-parser` validation and `$ref` resolution |
| YAML | `js-yaml` |
| Tests | `node:assert` executed with `tsx`; no Vitest dependency is currently configured |
| Runtime | Docker Compose; Node 20 images |

Vitest is mentioned in the original plan but is not present in the current
package manifests or test commands.

## Folder structure

```text
.
├── PLAN.md                    # Product goals, MVP rules and roadmap
├── DESIGN.md                  # This architecture reference
├── PROGRESS.md                # Milestone status and evidence
├── README.md                  # Setup, API usage and troubleshooting
├── specs/                     # Original provider OpenAPI YAML; read-only input
├── consumers/                 # Original consumer manifests; read-only input
├── webhook-receiver/          # Starter-kit alert receiver
└── app/
    ├── compose.yaml
    ├── server/
    │   ├── prisma/            # Schema, SQLite migrations and local database
    │   └── src/
    │       ├── engine/        # Normalization, diff and impact mapping
    │       ├── ingest/        # YAML parsing, import and lint
    │       ├── lib/           # Shared route normalization
    │       └── routes/        # Express API endpoints
    └── web/
        └── src/               # React status page and API client
```

### Frontend responsibilities

The current React page calls `GET /api/health`, polls every five seconds and
displays API, database/webhook health information. Vite proxies `/api` requests
to the local Express server. The planned provider, consumer, findings and
impact screens are future work.

### Backend responsibilities

Express exposes health, import, catalog, analysis, impact and publishing-check
routes. Ingestion validates and persists specs and manifests. The engine
compares stored valid specs and writes findings. The impact step associates
breaking findings with registered consumers. SQLite is the application store;
the webhook receiver is currently checked by the health route but is not sent
finding notifications.

## Database model

The Prisma schema is `app/server/prisma/schema.prisma`. JSON-like lists are
stored in SQLite-compatible string columns.

| Model | Purpose and relationships |
| --- | --- |
| `Provider` | Unique provider name; has many `SpecVersion` rows. |
| `SpecVersion` | Provider-owned specification version, publish order, source filename, validity, raw YAML and canonical JSON. `(providerId, publishOrder)` and `(providerId, fileName)` are unique. Version strings may repeat. |
| `Consumer` | Unique consumer name and team; has many `ConsumerUse` rows and impact associations. |
| `ConsumerUse` | Provider, method and path used by a consumer; stores original and normalized paths plus `sendsJson` and `readsJson`. |
| `Finding` | Provider, from/to version strings, severity, rule, field/operation path, message and notification flag. `consumer` is a denormalized display field. |
| `FindingConsumer` | Many-to-many join between findings and consumers, with a composite primary key to prevent duplicate impact links. |

`FindingConsumer` was added for M3 so one finding can name multiple consumers
without duplicating the finding itself. Deleting a finding or consumer cascades
to its association rows.

## API endpoints

All routes are mounted below `/api`. Request bodies are JSON.

| Method and path | Behavior |
| --- | --- |
| `GET /api/health` | Reports API, SQLite and webhook-receiver reachability. |
| `GET /api/providers` | Lists providers and ordered version metadata. |
| `GET /api/consumers` | Lists consumers and their usages. |
| `GET /api/findings` | Lists stored lint and engine findings. No query filters are implemented. |
| `POST /api/kit/import` | Imports the mounted/local starter-kit specs and consumer manifests. |
| `POST /api/providers/:name/specs` | Imports or updates one YAML spec using `fileName` and `content`. |
| `POST /api/consumers` | Imports/replaces one consumer manifest using `content`. |
| `POST /api/analyze` | Recomputes engine findings and then consumer impacts. |
| `GET /api/impacts` | Lists findings with `affectedConsumers`. |
| `POST /api/gate-check` | Evaluates a provider release. |
| `POST /api/publish/check` | Alias for the publishing check. |

`POST /api/gate-check` accepts `provider` and either `publishOrder` or
`version` (also accepted as `targetVersion`). `publishOrder` is preferred
because the data model allows duplicate version strings. Unknown providers or
versions return errors; invalid specs and ambiguous duplicate version strings
are rejected. The result includes a `decision` (`BLOCKED` or `ALLOWED`), a
lowercase `result` (`block`, `warn` or `allow`), affected consumers, fields,
explanation and warnings. Provider-internal breaking findings can produce
`result: "warn"` while the external-consumer decision remains `ALLOWED`.

### Data flow

1. `POST /api/kit/import` discovers numbered YAML files under `specs/` and
   consumer YAML files under `consumers/`; upload endpoints support individual
   specs/manifests.
2. The importer parses YAML, validates OpenAPI documents, resolves `$ref`s and
   stores raw and canonical documents. Invalid specs remain recorded with
   `valid=false` and a `SPEC_ERROR` finding.
3. Consumer paths are normalized so `{id}` and `{quoteId}` share the same
   matching key. Consumer usages keep the original path for display.
4. `POST /api/analyze` orders versions by `publishOrder`, skips invalid specs
   and diffs neighboring valid versions. Engine findings are replaced on each
   run, leaving import-lint findings intact.
5. Impact mapping matches the provider, method and normalized operation path;
   it uses response `reads` or request `sends` where supported by the rule and
   writes unique `FindingConsumer` rows.
6. The gate checks stored findings for the selected provider and target
   version. Run analysis after importing/updating data before relying on its
   verdict.

## Specification normalization and comparison

`parseSpec.ts` uses `js-yaml` and Swagger Parser to validate OpenAPI input and
resolve references. The resolved document is JSON-cloned and stored as
canonical JSON. The engine's `normalizeSpec` converts it into operations keyed
by uppercase method and normalized path. It retains `x-internal`, parameters,
JSON request schema and response schemas by status code.

Comparison uses `publishOrder`, not semantic version sorting. Only valid
versions with canonical documents participate; invalid versions are bridged
over rather than used as comparison endpoints. Normalized path parameters
avoid false changes when parameter names differ. Component names and `$ref`
layout do not participate in operation identity.

## Breaking-change rules

Rules currently implemented in `app/server/src/engine/diff.ts`:

| Contract change | Severity |
| --- | --- |
| Response field removed or renamed | `BREAKING` |
| Response field changes from required to optional | `BREAKING` |
| Request field added as required | `BREAKING` |
| Request enum narrowed | `BREAKING` |
| New required request parameter | `BREAKING` |
| Optional request/response field added, response enum widened, response enum narrowed, new response status, operation added | `INFO` |
| Request field removed | `INFO` |

The engine deliberately treats field direction differently. Required request
fields and narrowed request enums can break callers; response additions are
informational for readers. A required parameter on an `x-internal` operation
is still recorded as a provider-level breaking finding, with the operation
marked internal in its message.

Import lint currently records unresolvable/invalid specs as `SPEC_ERROR` and
same-version republishing as `WARN`. The planned `x-sunset`, deprecation,
early-removal and sunset-date rules are not implemented.

## Consumer impact and publishing gate

For each breaking finding, impact mapping extracts the HTTP operation from the
finding text and matches it against `ConsumerUse` by provider, method and
normalized path. Internal operations are excluded. Response findings are
compared to consumer `reads`; request enum findings are compared to `sends`.
New required request fields are attributed to consumers using the operation
because existing manifests may not list a field they do not yet send. Other
breaking request rules are operation-matched.

The gate blocks when a target release has at least one consumer-associated
`BREAKING` finding. Otherwise, it allows the release; provider-level/internal
and applicable non-breaking warnings are returned separately. It does not
publish a release or make changes to provider systems.

## Important decisions and limitations

- Publish lineage is `(providerId, publishOrder)`. Duplicate version strings
  are supported and surfaced by import lint.
- Consumer impacts use a join table; consumer names on `Finding.consumer` are
  retained as a comma-separated compatibility/display field.
- Gate lookup accepts `publishOrder`, but current finding selection uses
  `provider + toVersion` rather than publish order. Duplicate version strings
  can therefore make gate findings ambiguous even when the target slot was
  selected by publish order.
- The gate assumes analysis has been run. A valid but unanalyzed target has no
  stored engine findings to block it.
- The MVP comparison does not flag removed operations or schema type changes,
  and only compares JSON request/response schemas.
- Impact rule matching is intentionally simple; it is not a full static
  analysis of client code. In particular, request required-field attribution
  uses operation usage rather than proving a consumer sends the relevant
  sibling fields.
- The current suite uses `tsx` and Node assertions, not Vitest. The M3 test
  exercises the actual kit data and database; it does not replace dedicated
  HTTP/error-path coverage.
- No authentication or authorization layer is implemented. Do not expose this
  development service as a production publishing authority.
