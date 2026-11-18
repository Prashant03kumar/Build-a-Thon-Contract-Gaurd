// Milestone 2, step 1 — canonical doc → operation map.
//
// A stored `canonical` document is a fully $ref-resolved OpenAPI doc (see
// src/ingest/parseSpec.ts). This module reshapes it into a flat list of
// operations so the diff engine compares *contracts*, not YAML shapes:
//
//   - operations are keyed by `METHOD|<normalized path>` — path-param renames
//     ({id} → {quoteId}) normalize to the same key, so quote-api v1→v2 stays
//     a no-op (kit trap T3).
//   - x-internal survives dereferencing and is kept on the operation (B6).
//   - request/response schemas are the inlined JSON schemas themselves.
import { normalizeMethod, normalizePathTemplate } from "../lib/normalize";

export type JsonSchema = {
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [key: string]: unknown;
};

export type ParamData = { name: string; in: string; required: boolean };

export type OperationData = {
  key: string; // "POST|/quotes" — stable identity across versions
  operationId: string;
  method: string;
  path: string; // normalized: {id}/{quoteId}/... → {param}
  internal: boolean; // x-internal: true
  parameters: ParamData[];
  requestSchema: JsonSchema | null;
  responses: Record<string, JsonSchema | null>; // status code → schema (null = no JSON body)
};

export type NormalizedSpec = { operations: OperationData[] };

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

export function normalizeSpec(doc: unknown): NormalizedSpec {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paths = (doc as any)?.paths;
  const operations: OperationData[] = [];
  if (!paths || typeof paths !== "object") return { operations };

  for (const rawPath of Object.keys(paths)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pathItem: any = (paths as any)[rawPath];
    if (!pathItem || typeof pathItem !== "object") continue;
    const path = normalizePathTemplate(rawPath);

    for (const method of HTTP_METHODS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const op: any = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const parameters: ParamData[] = Array.isArray(op.parameters)
        ? op.parameters
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((p: any) => p && typeof p === "object" && typeof p.name === "string")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((p: any) => ({ name: String(p.name), in: String(p.in ?? ""), required: p.required === true }))
        : [];

      const requestSchema: JsonSchema | null = op.requestBody?.content?.["application/json"]?.schema ?? null;

      const responses: Record<string, JsonSchema | null> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const status of Object.keys(op.responses ?? {})) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responses[status] = (op.responses as any)[status]?.content?.["application/json"]?.schema ?? null;
      }

      const operationId =
        typeof op.operationId === "string" && op.operationId ? op.operationId : `${method.toUpperCase()} ${path}`;

      operations.push({
        key: `${normalizeMethod(method)}|${path}`,
        operationId,
        method: normalizeMethod(method),
        path,
        internal: op["x-internal"] === true,
        parameters,
        requestSchema,
        responses,
      });
    }
  }
  return { operations };
}
