import { PrismaClient } from "@prisma/client";

// Single shared Prisma client (connection pool) for the whole process.
// This is the METADATA store only — paste content never touches Postgres.
export const prisma = new PrismaClient();
