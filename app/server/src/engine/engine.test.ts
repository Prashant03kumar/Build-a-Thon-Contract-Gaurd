// Milestone 2 test suite — runs against the ACTUAL starter-kit specifications
// (no database needed: it exercises the real parse → normalize → diff path).
//
//   npm run test
//
// Expected results on the kit (see PLAN.md §4.4):
//   - B1..B6 all detected (11 BREAKING findings — some changes surface once per
//     operation, because shared schemas like Quote are returned by two endpoints)
//   - quote-api v1→v2 cosmetic reorg: ZERO findings (false-positive trap T3)
//   - the remaining engine findings are INFO additions
//   - claims-api file 2 fails validation and pairs starting from it are skipped
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { parseSpec, type SpecParseResult } from "../ingest/parseSpec";
import { kitDirs } from "../ingest/kitPaths";
import { normalizeSpec } from "./normalize";
import { diffSpecs, ENGINE_RULES, type FindingDraft } from "./diff";

let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type LoadedSpec = { fileName: string; parsed: SpecParseResult };

async function loadProvider(providerName: string): Promise<LoadedSpec[]> {
  const dir = path.join(kitDirs().specsDir, providerName);
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  const specs: LoadedSpec[] = [];
  for (const fileName of files) {
    const raw = fs.readFileSync(path.join(dir, fileName), "utf8");
    specs.push({ fileName, parsed: await parseSpec(raw) });
  }
  return specs;
}

// Mirrors /api/analyze's bridge rule (PLAN.md §8.1): only valid specs are diff
// endpoints, so a broken version in the middle is jumped over (claims: 1→3, 3→4).
// A diff INTO an invalid spec is skipped (returns null).
function consecutiveDiffs(specs: LoadedSpec[]): { pairs: FindingDraft[][]; skippedIntoInvalid: number } {
  const pairs: FindingDraft[][] = [];
  let skippedIntoInvalid = 0;
  let lastValid: LoadedSpec | null = null;
  for (const spec of specs) {
    if (!spec.parsed.valid || !spec.parsed.resolved) {
      skippedIntoInvalid++;
      continue; // broken spec never becomes a diff endpoint
    }
    if (lastValid) {
      const findings = diffSpecs(normalizeSpec(lastValid.parsed.resolved!), normalizeSpec(spec.parsed.resolved!), {
        fromVersion: lastValid.parsed.version ?? "",
        toVersion: spec.parsed.version ?? "",
      });
      pairs.push(findings);
    }
    lastValid = spec;
  }
  return { pairs, skippedIntoInvalid };
}

function flat(pairs: FindingDraft[][]): FindingDraft[] {
  return pairs.flat();
}

function rulesOf(findings: FindingDraft[]): string[] {
  return findings.map((f) => f.rule);
}

async function main(): Promise<void> {
  const quote = await loadProvider("quote-api");
  const policy = await loadProvider("policy-api");
  const claims = await loadProvider("claims-api");

  // ---------- quote-api (pairs: 1→2, 2→3, 3→4) ----------
  const quotePairs = consecutiveDiffs(quote);
  const q12 = quotePairs.pairs[0] ?? [];
  check("quote 1→2: cosmetic reorg produces ZERO findings (T3)", q12.length === 0, JSON.stringify(q12));

  const q23 = quotePairs.pairs[1] ?? [];
  check("quote 2→3: B1 rename detected (premium.breakdown[].amount → value)",
    q23.some((f) => f.rule === "response-field-renamed" && f.path === "premium.breakdown[].amount" && f.severity === "BREAKING"));
  check("quote 2→3: rename NOT misreported as plain removal",
    !q23.some((f) => f.rule === "response-field-removed" && f.path === "premium.breakdown[].amount"));
  check("quote 2→3: B6 required param on internal endpoint detected",
    q23.some((f) => f.rule === "request-param-required-added" && f.path.includes("region")));
  check("quote 2→3: B6 message marks the endpoint x-internal (no consumer blame later)",
    q23.filter((f) => f.rule === "request-param-required-added").every((f) => f.message.includes("x-internal")));
  check("quote 2→3: EXPIRED enum widening is INFO",
    q23.some((f) => f.rule === "response-enum-widened" && f.severity === "INFO" && f.path === "status"));
  check("quote 2→3: exactly 3 BREAKING (rename ×2 ops + param ×1)", q23.filter((f) => f.severity === "BREAKING").length === 3);

  const q34 = quotePairs.pairs[2] ?? [];
  check("quote 3→4: only INFO additions (taxes ×2, ncbPercent)",
    q34.length === 3 && q34.every((f) => f.severity === "INFO" && f.rule.endsWith("-added")));

  // ---------- policy-api (pairs: 1→2, 2→3, 3→4) ----------
  const policyPairs = consecutiveDiffs(policy);
  const p12 = policyPairs.pairs[0] ?? [];
  check("policy 1→2: deprecation flags alone produce ZERO findings in M2", p12.length === 0, JSON.stringify(p12));

  const p23 = policyPairs.pairs[1] ?? [];
  const p23paths = p23.filter((f) => f.rule === "response-field-removed").map((f) => f.path);
  check("policy 2→3: B3 legacyCode removal detected (GET /policies + GET /policies/{id})", p23paths.filter((p) => p === "legacyCode").length === 2);
  check("policy 2→3: phone removal detected (holder.phone)", p23paths.filter((p) => p === "holder.phone").length === 2);
  check("policy 2→3: all 4 removals are BREAKING", p23.length === 4 && p23.every((f) => f.severity === "BREAKING"));

  const p34 = policyPairs.pairs[2] ?? [];
  check("policy 3→4: B4 requestedBy now required detected",
    p34.some((f) => f.rule === "request-field-required-added" && f.path === "requestedBy" && f.severity === "BREAKING"));
  check("policy 3→4: B5 enum narrowed (VEHICLE dropped) detected",
    p34.some((f) => f.rule === "request-enum-narrowed" && f.path === "type" && f.message.includes("VEHICLE")));
  check("policy 3→4: exactly 2 BREAKING findings", p34.length === 2 && p34.every((f) => f.severity === "BREAKING"));

  // ---------- claims-api (valid specs: v1, v3, v4 → bridged pairs 1→3, 3→4) ----------
  check("claims file 2: dangling $ref makes the spec invalid (skip-safety)",
    claims[1].parsed.valid === false && (claims[1].parsed.error ?? "").includes("ClaimDocumnt"));

  const claimsPairs = consecutiveDiffs(claims);
  check("claims: invalid file 2 is skipped — diffs bridge 1→3 and 3→4",
    claimsPairs.pairs.length === 2 && claimsPairs.skippedIntoInvalid === 1);

  const c13 = claimsPairs.pairs[0] ?? [];
  check("claims 1→3 (bridged over invalid 1.1.0): INFO additions only (channel, assessorNotes ×2 ops)",
    c13.length === 3 && c13.every((f) => f.severity === "INFO") && c13.some((f) => f.rule === "request-field-added" && f.path === "channel"));

  const c34 = claimsPairs.pairs[1] ?? [];
  check("claims 3→4: B2 amountApproved demoted from required detected (×2 ops)",
    c34.filter((f) => f.rule === "response-required-demoted" && f.path === "amountApproved" && f.severity === "BREAKING").length === 2);
  check("claims 3→4: new 202 response is INFO",
    c34.some((f) => f.rule === "response-status-added" && f.path.endsWith("202")));
  check("claims 3→4: exactly 2 BREAKING findings", c34.filter((f) => f.severity === "BREAKING").length === 2);

  // ---------- whole-kit totals ----------
  const all: FindingDraft[] = [...flat(quotePairs.pairs), ...flat(policyPairs.pairs), ...flat(claimsPairs.pairs)];
  const breaking = all.filter((f) => f.severity === "BREAKING");
  check("whole kit: 11 BREAKING findings covering B1–B6", breaking.length === 11, `got ${breaking.length}`);
  check("whole kit: 9 INFO findings (non-breaking additions)", all.filter((f) => f.severity === "INFO").length === 9);
  check("whole kit: every rule emitted is a declared engine rule", all.every((f) => (ENGINE_RULES as readonly string[]).includes(f.rule)));
  check("whole kit: B1 present", breaking.some((f) => f.rule === "response-field-renamed"));
  check("whole kit: B2 present", breaking.some((f) => f.rule === "response-required-demoted"));
  check("whole kit: B3 present", breaking.some((f) => f.rule === "response-field-removed"));
  check("whole kit: B4 present", breaking.some((f) => f.rule === "request-field-required-added"));
  check("whole kit: B5 present", breaking.some((f) => f.rule === "request-enum-narrowed"));
  check("whole kit: B6 present", breaking.some((f) => f.rule === "request-param-required-added"));

  console.log("--------------------------------------------------");
  const counts: Record<string, number> = {};
  for (const f of all) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  console.log(`engine totals on the real kit: ${JSON.stringify(counts)} (${all.length} findings)`);
  if (failed > 0) {
    console.log(`RESULT: ${failed} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("RESULT: all checks passed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
