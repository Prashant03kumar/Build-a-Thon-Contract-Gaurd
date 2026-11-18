// Milestone 2, step 2 — the rule engine that compares two versions.
//
// Design rules that keep this honest (see PLAN.md §8):
//   1. DIRECTION MATTERS. The same structural change is breaking or safe
//      depending on whether it happens on the request side or the response side.
//   2. COSMETIC REORGS ARE INVISIBLE. Inputs are $ref-free canonical docs, so
//      component renames (Premium→PremiumDetails) and schema inlining never
//      appear — quote-api v1→v2 produces zero findings (kit trap T3).
//   3. One finding per (operation × change). The same shared schema (e.g. Quote)
//      is returned by two operations, so one kit change may surface as two
//      findings — both are real, per-operation contract changes.
import type { JsonSchema, NormalizedSpec, OperationData, ParamData } from "./normalize";

export type FindingDraft = {
  severity: "BREAKING" | "WARN" | "INFO";
  rule: string;
  path: string;
  message: string;
};

// Every rule this engine can emit. /api/analyze deletes exactly these rules
// before re-running, so repeated analyses never duplicate findings and the
// import-lint findings (spec-ref-unresolvable, version-republished) survive.
export const ENGINE_RULES = [
  "operation-added", // INFO
  "request-param-required-added", // BREAKING (B6; tagged internal via message)
  "request-field-required-added", // BREAKING (B4)
  "request-enum-narrowed", // BREAKING (B5)
  "request-enum-widened", // INFO
  "request-field-added", // INFO
  "request-field-removed", // INFO (extra fields sent by consumers are tolerated)
  "response-field-renamed", // BREAKING (B1)
  "response-field-removed", // BREAKING (B3)
  "response-required-demoted", // BREAKING (B2)
  "response-required-added", // INFO
  "response-field-added", // INFO
  "response-enum-widened", // INFO
  "response-enum-narrowed", // INFO (fewer values is safe for readers)
  "response-status-added", // INFO
] as const;

type Side = "request" | "response";
type Meta = { fromVersion: string; toVersion: string };

// ---------- small schema helpers ----------

function effectiveType(schema: JsonSchema | null | undefined): string {
  if (!schema || typeof schema !== "object") return "unknown";
  if (typeof schema.type === "string") return schema.type;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return "unknown";
}

function isObjectSchema(schema: JsonSchema | null | undefined): boolean {
  return !!schema && (schema.type === "object" || !!schema.properties);
}

function isArraySchema(schema: JsonSchema | null | undefined): boolean {
  return !!schema && (schema.type === "array" || !!schema.items);
}

function joinField(prefix: string, field: string): string {
  return prefix ? `${prefix}.${field}` : field;
}

// Named array ("premium.breakdown") → its items live at "premium.breakdown[]".
// A root-level array (GET /policies returns Policy[]) keeps "" so item fields
// stay clean ("legacyCode", not "[].legacyCode").
function itemsPrefix(prefix: string): string {
  return prefix ? `${prefix}[]` : "";
}

// Path params match by position regardless of name ({id} vs {quoteId} is the
// same wire param); query/header params match by real name.
function paramKey(p: ParamData): string {
  return `${p.in}:${p.in === "path" ? "param" : p.name}`;
}

function valueKey(v: unknown): string {
  return JSON.stringify(v);
}

// ---------- the diff ----------

export function diffSpecs(
  prev: NormalizedSpec,
  next: NormalizedSpec,
  meta: Meta,
): FindingDraft[] {
  const out: FindingDraft[] = [];
  const prevByKey = new Map(prev.operations.map((o) => [o.key, o]));

  for (const nextOp of next.operations) {
    const prevOp = prevByKey.get(nextOp.key);
    if (!prevOp) {
      out.push({
        severity: "INFO",
        rule: "operation-added",
        path: `${nextOp.method} ${nextOp.path}`,
        message: `Operation ${nextOp.method} ${nextOp.path} (${nextOp.operationId}) added in ${meta.toVersion}. Non-breaking.`,
      });
      continue;
    }
    diffOperation(prevOp, nextOp, meta, out);
  }
  return out;
}

function diffOperation(prevOp: OperationData, nextOp: OperationData, meta: Meta, out: FindingDraft[]): void {
  const ctx = `${nextOp.method} ${nextOp.path}`;
  const internalNote = nextOp.internal ? " (x-internal endpoint — internal contract change, not consumer-facing)" : "";

  // 1) Required parameters — B6 (region on DELETE /internal/pricing-cache).
  for (const np of nextOp.parameters) {
    if (!np.required) continue;
    const pp = prevOp.parameters.find((p) => paramKey(p) === paramKey(np));
    if (!pp || !pp.required) {
      out.push({
        severity: "BREAKING",
        rule: "request-param-required-added",
        path: `${ctx} · ${np.in} param '${np.name}'`,
        message: `${ctx}: new required ${np.in} parameter '${np.name}' in ${meta.toVersion}${internalNote}. Callers that do not send it will fail.`,
      });
    }
  }

  // 2) Request body — request direction.
  walkSchemaPair(prevOp.requestSchema, nextOp.requestSchema, "request", "", ctx, meta, out);

  // 3) Responses — response direction, per status code.
  for (const [status, nextSchema] of Object.entries(nextOp.responses)) {
    if (!(status in prevOp.responses)) {
      out.push({
        severity: "INFO",
        rule: "response-status-added",
        path: `${ctx} → ${status}`,
        message: `${ctx}: response ${status} is now documented in ${meta.toVersion}. Non-breaking.`,
      });
      continue;
    }
    walkSchemaPair(prevOp.responses[status] ?? null, nextSchema ?? null, "response", "", ctx, meta, out);
  }
  // Status codes that disappear are documentation-level changes — not flagged (kept simple).
}

function walkSchemaPair(
  prev: JsonSchema | null,
  next: JsonSchema | null,
  side: Side,
  prefix: string,
  ctx: string,
  meta: Meta,
  out: FindingDraft[],
): void {
  if (!prev || !next) return; // nothing comparable on one side
  if (isArraySchema(prev) && isArraySchema(next)) {
    walkSchemaPair(prev.items ?? null, next.items ?? null, side, itemsPrefix(prefix), ctx, meta, out);
    return;
  }
  if (isObjectSchema(prev) && isObjectSchema(next)) {
    walkObject(prev, next, side, prefix, ctx, meta, out);
  }
  // type changed (object→array etc.): intentionally not flagged in the MVP rule set
}

function walkObject(
  prev: JsonSchema,
  next: JsonSchema,
  side: Side,
  prefix: string,
  ctx: string,
  meta: Meta,
  out: FindingDraft[],
): void {
  const prevProps = prev.properties ?? {};
  const nextProps = next.properties ?? {};
  const prevRequired = new Set(prev.required ?? []);
  const nextRequired = new Set(next.required ?? []);

  const removed = Object.keys(prevProps).filter((k) => !(k in nextProps));
  const added = Object.keys(nextProps).filter((k) => !(k in prevProps));

  // Rename detection (B1, response side only): a field disappeared AND a new
  // field of the same JSON type appeared at the same level → one rename
  // finding instead of a confusing "removed + added" pair.
  const renameMap = new Map<string, string>(); // removed field → added field
  if (side === "response") {
    for (const r of removed) {
      const match = added.find((a) => effectiveType(nextProps[a]) === effectiveType(prevProps[r]));
      if (match) renameMap.set(r, match);
    }
  }
  const renameAdded = new Set(renameMap.values());

  for (const r of removed) {
    const renamedTo = renameMap.get(r);
    const path = joinField(prefix, r);
    if (renamedTo) {
      out.push({
        severity: "BREAKING",
        rule: "response-field-renamed",
        path,
        message: `${ctx}: response field '${path}' was renamed to '${joinField(prefix, renamedTo)}' in ${meta.toVersion}. Consumers reading '${path}' will break.`,
      });
    } else if (side === "response") {
      out.push({
        severity: "BREAKING",
        rule: "response-field-removed",
        path,
        message: `${ctx}: response field '${path}' no longer exists in ${meta.toVersion}. Consumers reading it will break.`,
      });
    } else {
      out.push({
        severity: "INFO",
        rule: "request-field-removed",
        path,
        message: `${ctx}: request field '${path}' removed in ${meta.toVersion}. Servers usually ignore extra fields — non-breaking.`,
      });
    }
  }

  for (const a of added) {
    const nowRequired = nextRequired.has(a);
    const path = joinField(prefix, a);
    if (renameAdded.has(a)) continue; // already reported as a rename
    if (side === "request") {
      if (nowRequired) {
        // B4 (requestedBy) lands here: new field that is immediately required.
        out.push({
          severity: "BREAKING",
          rule: "request-field-required-added",
          path,
          message: `${ctx}: request field '${path}' is required in ${meta.toVersion}. Callers must send it.`,
        });
      } else {
        out.push({
          severity: "INFO",
          rule: "request-field-added",
          path,
          message: `${ctx}: optional request field '${path}' added in ${meta.toVersion}. Non-breaking.`,
        });
      }
    } else {
      if (nowRequired) {
        out.push({
          severity: "INFO",
          rule: "response-required-added",
          path,
          message: `${ctx}: response field '${path}' is now always present (required) in ${meta.toVersion}. Non-breaking.`,
        });
      } else {
        out.push({
          severity: "INFO",
          rule: "response-field-added",
          path,
          message: `${ctx}: optional response field '${path}' added in ${meta.toVersion}. Non-breaking.`,
        });
      }
    }
  }

  // Required-list changes for fields present in BOTH versions.
  for (const f of Object.keys(nextProps)) {
    if (!(f in prevProps)) continue; // added/removed handled above
    const path = joinField(prefix, f);
    const wasRequired = prevRequired.has(f);
    const nowRequired = nextRequired.has(f);

    if (side === "response" && wasRequired && !nowRequired) {
      // B2 (amountApproved): still returned, but no longer guaranteed.
      out.push({
        severity: "BREAKING",
        rule: "response-required-demoted",
        path,
        message: `${ctx}: response field '${path}' is no longer guaranteed (removed from required) in ${meta.toVersion}. Consumers reading it must handle its absence.`,
      });
    }
    if (side === "response" && !wasRequired && nowRequired) {
      out.push({
        severity: "INFO",
        rule: "response-required-added",
        path,
        message: `${ctx}: response field '${path}' is now always present (required) in ${meta.toVersion}. Non-breaking.`,
      });
    }
    if (side === "request" && !wasRequired && nowRequired) {
      out.push({
        severity: "BREAKING",
        rule: "request-field-required-added",
        path,
        message: `${ctx}: request field '${path}' is now required in ${meta.toVersion}. Callers must send it.`,
      });
    }
    // request required→optional: relaxed constraint, safe — not flagged (kept simple)

    // B5 lives here: enums are compared on same-named fields.
    compareEnums(prevProps[f], nextProps[f], side, path, ctx, meta, out);

    // Recurse into matching structures.
    if (isArraySchema(prevProps[f]) && isArraySchema(nextProps[f])) {
      walkSchemaPair(prevProps[f].items ?? null, nextProps[f].items ?? null, side, itemsPrefix(path), ctx, meta, out);
    } else if (isObjectSchema(prevProps[f]) && isObjectSchema(nextProps[f])) {
      walkObject(prevProps[f], nextProps[f], side, path, ctx, meta, out);
    }
  }
}

function compareEnums(
  prev: JsonSchema,
  next: JsonSchema,
  side: Side,
  path: string,
  ctx: string,
  meta: Meta,
  out: FindingDraft[],
): void {
  const prevValues = Array.isArray(prev.enum) ? prev.enum : null;
  const nextValues = Array.isArray(next.enum) ? next.enum : null;
  if (!prevValues || !nextValues) return; // only compare when both declare enums

  const nextKeys = new Set(nextValues.map(valueKey));
  const prevKeys = new Set(prevValues.map(valueKey));
  const dropped = prevValues.filter((v) => !nextKeys.has(valueKey(v)));
  const introduced = nextValues.filter((v) => !prevKeys.has(valueKey(v)));

  const listed = (values: unknown[]) => values.map((v) => String(v)).join(", ");
  if (side === "request") {
    if (dropped.length > 0) {
      out.push({
        severity: "BREAKING",
        rule: "request-enum-narrowed",
        path,
        message: `${ctx}: request enum '${path}' no longer accepts ${listed(dropped)} in ${meta.toVersion}. Callers sending those values will be rejected.`,
      });
    }
    if (introduced.length > 0) {
      out.push({
        severity: "INFO",
        rule: "request-enum-widened",
        path,
        message: `${ctx}: request enum '${path}' now also accepts ${listed(introduced)} in ${meta.toVersion}. Non-breaking.`,
      });
    }
  } else {
    if (introduced.length > 0) {
      out.push({
        severity: "INFO",
        rule: "response-enum-widened",
        path,
        message: `${ctx}: response enum '${path}' widened in ${meta.toVersion}: added ${listed(introduced)}. Consumers should be prepared for new values.`,
      });
    }
    if (dropped.length > 0) {
      out.push({
        severity: "INFO",
        rule: "response-enum-narrowed",
        path,
        message: `${ctx}: response enum '${path}' narrowed in ${meta.toVersion}: removed ${listed(dropped)}. Fewer values is safe for readers.`,
      });
    }
  }
}
