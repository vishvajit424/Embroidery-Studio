/// <reference types="@shopify/polaris-types" />
/// <reference types="@shopify/app-bridge-types" />

declare global {
  var __embroideryPrisma: import("@prisma/client").PrismaClient | undefined;
}

export {};
