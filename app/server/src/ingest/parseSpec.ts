// OpenAPI spec ingestion: YAML → validated + dereferenced document.
// SwaggerParser.validate() does full OpenAPI 3.0.3 schema validation AND
// $ref resolution — a dangling ref (claims-api file 2: ClaimDocumnt) throws,
// which is exactly the SPEC_ERROR finding we want, not a crash.
import yaml from "js-yaml";
import SwaggerParser from "@apidevtools/swagger-parser";

export type SpecParseResult = {
  version: string | null; // info.version (null if unparseable)
  valid: boolean;
  error: string | null;
  resolved: unknown | null; // $ref-free document (canonical input for M2 diffing)
};

function cleanError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, " ").trim().slice(0, 400);
}

export async function parseSpec(raw: string): Promise<SpecParseResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    return { version: null, valid: false, error: `YAML parse error: ${cleanError(err)}`, resolved: null };
  }
  if (!doc || typeof doc !== "object") {
    return { version: null, valid: false, error: "Document is not an OpenAPI object", resolved: null };
  }
  const version =
    typeof doc?.info?.version === "string" && doc.info.version.trim() ? doc.info.version.trim() : null;

  const parser = new SwaggerParser();
  try {
    await parser.validate(doc); // OAS schema validation + $ref resolution
    const resolved = await parser.dereference(doc); // inline every $ref
    let canonical: unknown = null;
    try {
      canonical = JSON.parse(JSON.stringify(resolved)); // clone to a plain JSON-able structure
    } catch {
      canonical = null; // circular structures would throw here — keep raw only
    }
    return { version, valid: true, error: null, resolved: canonical };
  } catch (err) {
    return { version, valid: false, error: cleanError(err), resolved: null };
  }
}
