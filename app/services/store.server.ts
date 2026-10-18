import prisma from "../db.server";
import {
  DEFAULT_COLORS,
  DEFAULT_FONTS,
  DEFAULT_ICONS,
  DEFAULT_OPTIONS,
  DEFAULT_POSITIONS,
} from "../utils/defaults";
import { log } from "./logger.server";

/** Returns the shop's Store row, creating it and seeding the default library
 * the first time the shop opens the app. */
export async function getStore(shop: string) {
  const existing = await prisma.store.findUnique({ where: { shop } });
  if (existing) return existing;

  try {
    const store = await prisma.$transaction(async (tx) => {
      const created = await tx.store.create({ data: { shop } });
      await tx.embroideryOption.createMany({
        data: DEFAULT_OPTIONS.map((o) => ({ shop, key: o.key, label: o.label, description: o.description, sortOrder: o.sortOrder })),
      });
      await tx.embroideryColor.createMany({
        data: DEFAULT_COLORS.map((c, i) => ({ shop, name: c.name, hex: c.hex, sortOrder: i })),
      });
      await tx.embroideryFont.createMany({
        data: DEFAULT_FONTS.map((f, i) => ({ shop, name: f.name, cssFamily: f.cssFamily, previewText: f.previewText, sortOrder: i })),
      });
      await tx.embroideryIcon.createMany({
        data: DEFAULT_ICONS.map((icon, i) => ({ shop, name: icon.name, imageUrl: `asset:${icon.file}`, placement: icon.placement, sortOrder: i })),
      });
      await tx.embroideryPosition.createMany({
        data: DEFAULT_POSITIONS.map((p) => ({ shop, ...p })),
      });
      return created;
    });
    log.info("store.created", { shop });
    return store;
  } catch (error) {
    // Two requests raced to create the store - use the winner's row.
    const again = await prisma.store.findUnique({ where: { shop } });
    if (again) return again;
    throw error;
  }
}

export function storeNumbers(store: Awaited<ReturnType<typeof getStore>>) {
  return {
    topPrice: Number(store.topPrice),
    bottomPrice: Number(store.bottomPrice),
    logoPrice: Number(store.logoPrice),
    bundlePrice: Number(store.bundlePrice),
    bundleCompareAt: Number(store.bundleCompareAt),
    uploadMaxMb: store.uploadMaxMb,
    currencyCode: store.currencyCode,
    topVariantId: store.topVariantId,
    bottomVariantId: store.bottomVariantId,
    logoVariantId: store.logoVariantId,
    bundleVariantId: store.bundleVariantId,
  };
}

/** Removes everything stored for a shop (uninstall / shop redact). */
export async function deleteShopData(shop: string) {
  await prisma.store.deleteMany({ where: { shop } }); // cascades to all child tables
  await prisma.session.deleteMany({ where: { shop } });
}
