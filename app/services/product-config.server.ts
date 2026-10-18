import prisma from "../db.server";
import { buildProductMetafield, configProblems, type ProductConfigInput } from "../utils/config";
import { isShopifyGid } from "../utils/validation";
import { getStore } from "./store.server";
import { gql, userErrorsMessage, type AdminGraphql, ShopifyApiError } from "./types";
import { log } from "./logger.server";

type ConfigRow = NonNullable<Awaited<ReturnType<typeof prisma.productEmbroideryConfig.findUnique>>>;
type StoreRow = Awaited<ReturnType<typeof getStore>>;

const METAFIELDS_SET = `#graphql
mutation EmbroiderySetProductConfig($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}`;

const VARIANTS_QUERY = `#graphql
query EmbroideryVariants($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      title
      price
      product { id title status featuredMedia { preview { image { url } } } }
    }
  }
}`;

export type VariantInfo = { id: string; title: string; productTitle: string; price: string; status: string; image?: string };

export function toInput(row: ConfigRow): ProductConfigInput {
  return {
    enabled: row.enabled,
    topEnabled: row.topEnabled,
    bottomEnabled: row.bottomEnabled,
    logoEnabled: row.logoEnabled,
    bundleEnabled: row.bundleEnabled,
    topPrice: Number(row.topPrice),
    bottomPrice: Number(row.bottomPrice),
    logoPrice: Number(row.logoPrice),
    bundlePrice: Number(row.bundlePrice),
    bundleCompareAt: Number(row.bundleCompareAt),
    topPosition: row.topPosition,
    iconPosition: row.iconPosition,
    bottomPosition: row.bottomPosition,
    positionOverrides: row.positionOverrides,
    bottomImageUrl: row.bottomImageUrl,
    uploadMaxSize: row.uploadMaxSize,
    requireName: row.requireName,
    maxChars: row.maxChars,
    topVariantId: row.topVariantId,
    bottomVariantId: row.bottomVariantId,
    logoVariantId: row.logoVariantId,
    bundleVariantId: row.bundleVariantId,
  };
}

/** Plain, serialisable view of a config row for loaders. */
export function serializeConfig(row: ConfigRow) {
  return { ...toInput(row), id: row.id, productId: row.productId, productTitle: row.productTitle, syncedAt: row.syncedAt?.toISOString() || null, syncError: row.syncError };
}

export function defaultInput(store: StoreRow): ProductConfigInput {
  return {
    enabled: false,
    topEnabled: true,
    bottomEnabled: true,
    logoEnabled: true,
    bundleEnabled: true,
    topPrice: Number(store.topPrice),
    bottomPrice: Number(store.bottomPrice),
    logoPrice: Number(store.logoPrice),
    bundlePrice: Number(store.bundlePrice),
    bundleCompareAt: Number(store.bundleCompareAt),
    topPosition: "leftChest",
    iconPosition: "rightChest",
    bottomPosition: "leftSide",
    positionOverrides: "{}",
    bottomImageUrl: null,
    uploadMaxSize: store.uploadMaxMb,
    requireName: true,
    maxChars: 22,
    topVariantId: null,
    bottomVariantId: null,
    logoVariantId: null,
    bundleVariantId: null,
  };
}

/** Looks up variants in Shopify so the admin can show - and verify - the
 * real product/variant behind each mapped add-on. */
export async function lookupVariants(admin: AdminGraphql, ids: Array<string | null | undefined>) {
  const valid = [...new Set(ids.filter((id): id is string => isShopifyGid(id, "ProductVariant")))];
  const map: Record<string, VariantInfo> = {};
  if (!valid.length) return map;
  const data = await gql(admin, VARIANTS_QUERY, { ids: valid });
  for (const node of data.nodes || []) {
    if (!node?.id) continue;
    map[node.id] = {
      id: node.id,
      title: node.title,
      price: node.price,
      productTitle: node.product?.title || "",
      status: node.product?.status || "",
      image: node.product?.featuredMedia?.preview?.image?.url,
    };
  }
  return map;
}

async function writeMetafield(admin: AdminGraphql, productId: string, value: unknown) {
  const data = await gql(admin, METAFIELDS_SET, {
    metafields: [{ ownerId: productId, namespace: "$app:embroidery", key: "config", type: "json", value: JSON.stringify(value) }],
  });
  const errors = userErrorsMessage(data.metafieldsSet?.userErrors);
  if (errors) throw new ShopifyApiError(errors);
}

/** Writes the product metafield and records the sync result on the row. */
export async function syncProduct(admin: AdminGraphql, row: ConfigRow, store: StoreRow) {
  const metafield = buildProductMetafield(toInput(row), store);
  try {
    await writeMetafield(admin, row.productId, metafield);
    await prisma.productEmbroideryConfig.update({ where: { id: row.id }, data: { syncedAt: new Date(), syncError: null } });
    log.info("product_config.synced", { shop: row.shop, productId: row.productId, enabled: metafield.enabled });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await prisma.productEmbroideryConfig.update({ where: { id: row.id }, data: { syncError: message } });
    log.error("product_config.sync_failed", { shop: row.shop, productId: row.productId, error });
    return message;
  }
}

export type SaveResult = { ok: boolean; errors: string[]; warnings: string[] };

/** Validates, stores and publishes a product configuration. */
export async function saveProductConfig(
  admin: AdminGraphql,
  shop: string,
  product: { id: string; title: string; handle: string; imageUrl?: string | null },
  input: ProductConfigInput,
): Promise<SaveResult> {
  const store = await getStore(shop);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isShopifyGid(product.id, "Product")) errors.push("Invalid product.");

  // Every mapped add-on must be a real variant, and not a variant of this product.
  const ids = [input.topVariantId, input.bottomVariantId, input.logoVariantId, input.bundleVariantId,
    store.topVariantId, store.bottomVariantId, store.logoVariantId, store.bundleVariantId];
  const found = await lookupVariants(admin, ids);
  for (const [label, id] of [["Top", input.topVariantId], ["Bottom", input.bottomVariantId], ["Logo", input.logoVariantId], ["Bundle", input.bundleVariantId]] as const) {
    if (!id) continue;
    if (!found[id]) errors.push(`${label} add-on variant no longer exists in Shopify.`);
  }
  const problems = configProblems(input, store);
  if (input.enabled && problems.length) errors.push(...problems);
  else warnings.push(...problems);

  if (input.bundleEnabled && input.bundlePrice >= input.topPrice + input.logoPrice + input.bottomPrice) {
    warnings.push("The bundle price is not lower than buying Top + Icon/Logo + Bottom separately.");
  }
  if (errors.length) return { ok: false, errors, warnings };

  const data = { ...input, positionOverrides: typeof input.positionOverrides === "string" ? input.positionOverrides : JSON.stringify(input.positionOverrides) };
  const row = await prisma.productEmbroideryConfig.upsert({
    where: { shop_productId: { shop, productId: product.id } },
    update: { ...data, productTitle: product.title, productHandle: product.handle, imageUrl: product.imageUrl || null },
    create: { ...data, shop, productId: product.id, productTitle: product.title, productHandle: product.handle, imageUrl: product.imageUrl || null },
  });
  log.info("product_config.saved", { shop, productId: product.id, enabled: input.enabled });

  const syncError = await syncProduct(admin, row, store);
  if (syncError) return { ok: false, errors: [`Saved, but publishing to the storefront failed: ${syncError}`], warnings };
  return { ok: true, errors, warnings };
}

/** Re-publishes every configured product (after defaults/add-ons change). */
export async function resyncAllProducts(admin: AdminGraphql, shop: string) {
  const store = await getStore(shop);
  const rows = await prisma.productEmbroideryConfig.findMany({ where: { shop } });
  let failed = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    try {
      const data = await gql(admin, METAFIELDS_SET, {
        metafields: chunk.map((row) => ({
          ownerId: row.productId,
          namespace: "$app:embroidery",
          key: "config",
          type: "json",
          value: JSON.stringify(buildProductMetafield(toInput(row), store)),
        })),
      });
      const errors = userErrorsMessage(data.metafieldsSet?.userErrors);
      if (errors) throw new ShopifyApiError(errors);
      await prisma.productEmbroideryConfig.updateMany({ where: { id: { in: chunk.map((r) => r.id) } }, data: { syncedAt: new Date(), syncError: null } });
    } catch (error) {
      failed += chunk.length;
      log.error("product_config.resync_failed", { shop, error });
    }
  }
  return { total: rows.length, failed };
}

/** Quick enable/disable from the products list. */
export async function setProductEnabled(admin: AdminGraphql, shop: string, productId: string, enabled: boolean, product?: { title: string; handle: string; imageUrl?: string | null }) {
  const store = await getStore(shop);
  const existing = await prisma.productEmbroideryConfig.findUnique({ where: { shop_productId: { shop, productId } } });
  const input = existing ? toInput(existing) : defaultInput(store);
  input.enabled = enabled;
  if (enabled) {
    const problems = configProblems(input, store);
    if (problems.length) return { ok: false, errors: problems, warnings: [] } as SaveResult;
  }
  return saveProductConfig(admin, shop, {
    id: productId,
    title: product?.title || existing?.productTitle || "",
    handle: product?.handle || existing?.productHandle || "",
    imageUrl: product?.imageUrl ?? existing?.imageUrl,
  }, input);
}
