import { PrismaClient } from "@prisma/client";

const prisma = globalThis.__embroideryPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__embroideryPrisma = prisma;
}

export default prisma;
