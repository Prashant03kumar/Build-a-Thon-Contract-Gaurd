import { prisma } from "../db";
import { normalizeMethod, normalizePathTemplate } from "../lib/normalize";

type FindingLike = {
  id: string;
  provider: string;
  severity: string;
  rule: string;
  path: string;
  message: string;
};

export function findingOperation(finding: FindingLike): { method: string; path: string } | null {
  const match = `${finding.message}\n${finding.path}`.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s·:]+)/i);
  if (!match) return null;
  return { method: normalizeMethod(match[1]), path: normalizePathTemplate(match[2]) };
}

function fieldKey(value: string): string {
  return value.replace(/\[\]/g, "").replace(/^\.+/, "").trim();
}

function consumerReadsField(reads: string[], field: string): boolean {
  const wanted = fieldKey(field);
  return reads.some((read) => {
    const have = fieldKey(read);
    return have === wanted || have.endsWith(`.${wanted}`) || wanted.endsWith(`.${have}`);
  });
}

function consumerSendsField(sends: string[], field: string): boolean {
  const wanted = fieldKey(field);
  return sends.some((send) => {
    const have = fieldKey(send);
    return have === wanted || have.endsWith(`.${wanted}`) || wanted.endsWith(`.${have}`);
  });
}

export async function recomputeFindingImpacts(): Promise<number> {
  await prisma.findingConsumer.deleteMany();

  const findings = await prisma.finding.findMany({ orderBy: { id: "asc" } });
  let impactCount = 0;

  for (const finding of findings) {
    if (finding.severity !== "BREAKING") {
      await prisma.finding.update({ where: { id: finding.id }, data: { consumer: null } });
      continue;
    }

    const operation = findingOperation(finding);
    if (!operation || /x-internal endpoint/i.test(finding.message)) {
      await prisma.finding.update({ where: { id: finding.id }, data: { consumer: null } });
      continue;
    }

    const usages = await prisma.consumerUse.findMany({
      where: {
        providerName: finding.provider,
        method: operation.method,
        pathNorm: operation.path,
      },
      include: { consumer: true },
    });

    const matched = new Map<string, { id: string; name: string }>();
    for (const usage of usages) {
      let applies = true;
      if (finding.rule.startsWith("response-")) {
        applies = consumerReadsField(JSON.parse(usage.readsJson) as string[], finding.path);
      } else if (finding.rule === "request-field-required-added" || finding.rule === "request-enum-narrowed") {
        const sends = JSON.parse(usage.sendsJson) as string[];
        // Required request fields may be missing from a manifest; callers of the
        // operation are still affected. Enum narrowing is field-sensitive.
        applies = finding.rule === "request-field-required-added"
          || consumerSendsField(sends, finding.path);
      }

      if (applies) matched.set(usage.consumerId, { id: usage.consumerId, name: usage.consumer.name });
    }

    if (matched.size > 0) {
      await prisma.findingConsumer.createMany({
        data: [...matched.values()].map((consumer) => ({
          findingId: finding.id,
          consumerId: consumer.id,
        })),
      });
      const names = [...matched.values()].map((consumer) => consumer.name).sort();
      await prisma.finding.update({
        where: { id: finding.id },
        data: { consumer: names.join(", ") },
      });
      impactCount += matched.size;
    } else {
      await prisma.finding.update({ where: { id: finding.id }, data: { consumer: null } });
    }
  }

  return impactCount;
}
