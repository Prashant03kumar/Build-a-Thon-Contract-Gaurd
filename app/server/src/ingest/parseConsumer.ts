// Consumer manifest ingestion: the kit's simple YAML format
// (consumer / team / uses[{provider, method, path, sends[], reads[]}]).
import yaml from "js-yaml";
import { normalizeMethod, normalizePathTemplate } from "../lib/normalize";

export type ParsedUsage = {
  providerName: string;
  method: string;
  pathRaw: string; // as written, for display
  pathNorm: string; // {param}-normalized, for matching
  sends: string[];
  reads: string[];
};

export type ParsedConsumer = { name: string; team: string; usages: ParsedUsage[] };

export function parseConsumerManifest(raw: string): ParsedConsumer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = yaml.load(raw);
  if (!doc || typeof doc !== "object") throw new Error("document is not a YAML object");

  const name = typeof doc.consumer === "string" ? doc.consumer.trim() : "";
  if (!name) throw new Error("missing 'consumer' field");
  const team = typeof doc.team === "string" ? doc.team.trim() : "";

  const uses: any[] = Array.isArray(doc.uses) ? doc.uses : [];
  const usages = uses.map((u, index) => {
    if (!u || typeof u !== "object") throw new Error(`uses[${index}] is not an object`);
    const provider = typeof u.provider === "string" ? u.provider.trim() : "";
    const method = typeof u.method === "string" ? normalizeMethod(u.method) : "";
    const path = typeof u.path === "string" ? u.path.trim() : "";
    if (!provider || !method || !path) {
      throw new Error(`uses[${index}] must have non-empty provider, method and path`);
    }
    const sends = Array.isArray(u.sends) ? u.sends.filter((s: unknown): s is string => typeof s === "string") : [];
    const reads = Array.isArray(u.reads) ? u.reads.filter((s: unknown): s is string => typeof s === "string") : [];
    return { providerName: provider, method, pathRaw: path, pathNorm: normalizePathTemplate(path), sends, reads };
  });

  return { name, team, usages };
}
