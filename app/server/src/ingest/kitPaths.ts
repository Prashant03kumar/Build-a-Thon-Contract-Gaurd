// Where the starter-kit data lives, resolved the same way everywhere
// (import route, tests): compose mounts it at $KIT_DATA_DIR; locally the kit
// sits two levels above app/server.
import fs from "node:fs";
import path from "node:path";

function defaultDir(sub: "specs" | "consumers"): string {
  const base = [
    path.resolve(process.cwd(), "..", ".."), // app/server → starter-kit root
    path.resolve(process.cwd(), "..", "..", ".."), // fallback for alternate cwd
  ].find((candidate) => fs.existsSync(path.join(candidate, sub)));
  return path.join(base ?? path.resolve(process.cwd(), "..", ".."), sub);
}

export function kitDirs(): { specsDir: string; consumersDir: string } {
  const specsDir =
    process.env.KIT_SPECS_DIR ??
    (process.env.KIT_DATA_DIR ? path.join(process.env.KIT_DATA_DIR, "specs") : defaultDir("specs"));
  const consumersDir =
    process.env.KIT_CONSUMERS_DIR ??
    (process.env.KIT_DATA_DIR ? path.join(process.env.KIT_DATA_DIR, "consumers") : defaultDir("consumers"));
  return { specsDir, consumersDir };
}
