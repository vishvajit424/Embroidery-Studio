import prisma from "../db.server";
import { buildLibrary } from "../utils/config";
import { getStore } from "./store.server";
import { gql, userErrorsMessage, type AdminGraphql, ShopifyApiError } from "./types";
import { log } from "./logger.server";

const APP_INSTALLATION_QUERY = `#graphql
query EmbroideryAppInstallation { currentAppInstallation { id } }`;

const METAFIELDS_SET = `#graphql
mutation EmbroiderySetLibrary($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}`;

export async function loadLibraryRows(shop: string) {
  const [options, colors, fonts, icons, positions] = await Promise.all([
    prisma.embroideryOption.findMany({ where: { shop }, orderBy: { sortOrder: "asc" } }),
    prisma.embroideryColor.findMany({ where: { shop }, orderBy: { sortOrder: "asc" } }),
    prisma.embroideryFont.findMany({ where: { shop }, orderBy: { sortOrder: "asc" } }),
    prisma.embroideryIcon.findMany({ where: { shop }, orderBy: { sortOrder: "asc" } }),
    prisma.embroideryPosition.findMany({ where: { shop }, orderBy: [{ area: "desc" }, { name: "asc" }] }),
  ]);
  return { options, colors, fonts, icons, positions };
}

/** Publishes the shop's design library (colors, fonts, icons, positions,
 * option labels) to the app-installation metafield `embroidery.library`,
 * which the theme block reads as `app.metafields.embroidery.library`. */
export async function syncLibrary(admin: AdminGraphql, shop: string) {
  const store = await getStore(shop);
  const rows = await loadLibraryRows(shop);
  const library = buildLibrary({ ...rows, uploadMaxMb: store.uploadMaxMb });

  const data = await gql(admin, APP_INSTALLATION_QUERY);
  const ownerId = data.currentAppInstallation?.id;
  if (!ownerId) throw new ShopifyApiError("Could not read the app installation id.");

  const result = await gql(admin, METAFIELDS_SET, {
    metafields: [{ ownerId, namespace: "embroidery", key: "library", type: "json", value: JSON.stringify(library) }],
  });
  const errors = userErrorsMessage(result.metafieldsSet?.userErrors);
  if (errors) {
    log.error("library.sync_failed", { shop, errors });
    throw new ShopifyApiError(errors);
  }
  await prisma.store.update({ where: { shop }, data: { librarySyncedAt: new Date() } });
  log.info("library.synced", { shop, colors: library.colors.length, fonts: library.fonts.length, icons: library.icons.length });
  return library;
}

/** Runs a library change and republishes; returns an error message or null. */
export async function withLibrarySync(admin: AdminGraphql, shop: string, change: () => Promise<unknown>): Promise<string | null> {
  await change();
  try {
    await syncLibrary(admin, shop);
    return null;
  } catch (error) {
    log.error("library.sync_error", { shop, error });
    return error instanceof Error ? error.message : "Could not publish the library to the storefront.";
  }
}
