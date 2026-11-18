# Contract Guard — Design

## Purpose

Contract Guard makes API evolution visible before consumers encounter unexpected changes. It combines a lightweight contract registry, compatibility analysis, consumer impact mapping, a publishing decision and webhook notifications in one application.

This document describes the current implementation, not a guarantee of compatibility for every OpenAPI feature. See [PLAN.md](PLAN.md) for scope and [PROGRESS.md](PROGRESS.md) for recorded verification.

## Architecture

```text
Browser (React + Vite)
        | /api requests
        v
Express API ---- Prisma ---- SQLite (persistent Docker volume)
    |    |                    providers, versions, consumers, findings, impacts
    |    +---- validate / normalize / compare / match impacts
    |
    +---- HTTP POST ----> starter-kit webhook receiver
        ^
        | read-only import
  starter-kit specs + consumer manifests
```

In Docker, Express serves the built dashboard and API on port 3001. The receiver is exposed on host port 9900. During local development, Vite proxies `/api` to the API server. Compose mounts the starter-kit inputs read-only.

## Data model

| Model | Responsibility |
| --- | --- |
| `Provider` | API owner, identified by name |
| `SpecVersion` | Source filename, version string, publish order, validity, raw YAML and dereferenced JSON |
| `Consumer` | Consuming service and its team |
| `ConsumerUse` | Provider, method, normalized path and declared request/response fields |
| `Finding` | Detected change or import issue, severity, explanation and notification flag |
| `FindingConsumer` | Many-to-many association between findings and affected consumers |

`(providerId, publishOrder)` identifies a lineage slot; `(providerId, fileName)` supports repeatable imports. Version strings are not unique: claims-api republishes `1.1.0`.

## Processing pipeline

### Import and validation

Provider folders are discovered from the kit, and files are ordered by their numeric prefixes. Swagger Parser validates and dereferences each specification. The raw document is preserved, and serializable dereferenced JSON is stored for comparison. An invalid document remains in the registry with `valid=false`; import lint reports the error. Consumer manifests are parsed into usages, with path parameters normalized to `{param}`.

### Comparison

Analysis orders each provider's usable versions by publish order and compares consecutive valid versions, bridging over invalid entries. The normalizer extracts operations, parameters, request bodies and response schemas from dereferenced documents. Operations are matched by HTTP method and normalized path; `operationId` is retained as metadata. Component renames and the kit's path-parameter rename therefore do not produce a cosmetic finding.

Rules distinguish request and response directions. Examples include removed or no-longer-required response fields, newly required request fields or parameters, narrowed request enums, and selected informational additions. Shared schemas can produce separate findings for different operations. This is a targeted rule engine, not a complete OpenAPI semantic diff.

### Consumer impact

The impact engine extracts an operation from a finding and matches it to consumer usages by provider, method and normalized path. For response changes it checks declared `reads`; for request enum narrowing it checks `sends`; a newly required request field affects callers of that operation even if it was not previously listed. Findings for `x-internal` endpoints are not attributed to external consumers. Impacts are stored in `FindingConsumer` and recalculated during analysis.

Matching relies on declared manifests and operation context embedded in finding text; it is an approximation rather than observed runtime traffic.

### Publishing gate

The gate accepts a provider and either a publish order or an unambiguous version. Invalid target specifications are rejected. It returns **BLOCKED** when a BREAKING finding for the target version has an affected consumer; otherwise it returns **ALLOWED**, with `warn` in the detailed result when applicable internal or other warnings exist. The endpoint is advisory: integration into an actual release pipeline is the caller's responsibility.

The gate queries findings by target *version string*, not by a unique version-row ID. Republished strings can therefore conflate findings across slots. It also depends on analysis having been run after the relevant import or change.

### Notifications

After impact calculation, analysis posts pending BREAKING findings to `/contract-guard` on the configured receiver. A successful HTTP response sets `notified=true`; failures remain pending for later analysis or a retry. A process-local in-flight set reduces overlapping sends in one server process. There is no durable queue or exactly-once delivery guarantee.

`POST /api/notifications/retry` retries pending findings. An explicit `resendAll` request sends already-notified findings again and can create duplicate inbox events. Clearing the receiver affects its in-memory inbox only; it does not change delivery flags.

## Dashboard

The responsive single-page dashboard shows provider/version counts, findings, consumers, publishing decisions and webhook status. It retrieves affected consumers from `/api/impacts` and notification flags from `/api/findings`, joining them by finding ID. Gate requests use publish order, and unknown gate results are displayed as unknown rather than invalid.

Health is polled periodically; other dashboard data is refreshed on load and after actions. The receiver address reported by Docker is container-internal and may not be directly usable as a browser link. Only BREAKING findings are eligible for webhook delivery, although the finding list displays a delivery dot for every severity.

## Implementation boundaries

- SQLite and a single API process keep the demo straightforward; distributed delivery and production-scale concurrency are outside the current design.
- Sunset/deprecation deadline rules and a full OpenAPI compatibility engine are not implemented.
- No authentication or authorization is described for these endpoints; do not expose the demo as a production service without additional controls.
