import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Docker/compose always sets DATABASE_URL (file:/data/guard.db). This fallback
// makes local `npm run dev` work with zero extra config: it points at
// <server>/prisma/dev.db — the same file `npm run db:migrate` creates
// (the CLI resolves file:./dev.db relative to prisma/schema.prisma).
process.env.DATABASE_URL ??= `file:${path.resolve(__dirname, "..", "prisma", "dev.db").replace(/\\/g, "/")}`;

export const prisma = new PrismaClient();
