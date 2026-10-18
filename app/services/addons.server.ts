import prisma from "../db.server";
import { gql, userErrorsMessage, type AdminGraphql, ShopifyApiError } from "./types";
import { log } from "./logger.server";

export const ADDON_TAG = "embroidery-addon";

const ADDONS = [
  { key: "top", title: "Embroidery — Top" },
  { key: "bottom", title: "Embroidery — Bottom" },
  { key: "logo", title: "Embroidery — Icon / Logo" },
  { key: "bundle", title: "Embroidery — Bundle" },
] as const;

const PRODUCT_CREATE = `#graphql
mutation EmbroideryAddonCreate($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product { id variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}`;

const VARIANT_UPDATE = `#graphql
mutation EmbroideryAddonVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

/**
 * Creates the four dedicated add-on products (price 0 - the Cart Transform
 * sets the real price), untracked and not requiring shipping, and saves them
 * as the shop-wide default add-on variants. Only fills in missing mappings.
 */
export async function createAddonProducts(admin: AdminGraphql, shop: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { shop } });
  const current: Record<string, string | null> = {
    top: store.topVariantId, bottom: store.bottomVariantId, logo: store.logoVariantId, bundle: store.bundleVariantId,
  };
  const created: string[] = [];

  for (const addon of ADDONS) {
    if (current[addon.key]) continue;
    const data = await gql(admin, PRODUCT_CREATE, {
      product: {
        title: addon.title,
        tags: [ADDON_TAG],
        productType: "Embroidery add-on",
        status: "ACTIVE",
        descriptionHtml: "<p>Embroidery add-on. Added automatically by Embroidery Studio - do not sell on its own.</p>",
      },
    });
    const errors = userErrorsMessage(data.productCreate?.userErrors);
    const product = data.productCreate?.product;
    const variantId = product?.variants?.nodes?.[0]?.id;
    if (errors || !product || !variantId) throw new ShopifyApiError(errors || `Could not create ${addon.title}.`);

    const variantData = await gql(admin, VARIANT_UPDATE, {
      productId: product.id,
      variants: [{ id: variantId, price: "0.00", inventoryPolicy: "CONTINUE", inventoryItem: { tracked: false, requiresShipping: false } }],
    });
    const variantErrors = userErrorsMessage(variantData.productVariantsBulkUpdate?.userErrors);
    if (variantErrors) throw new ShopifyApiError(variantErrors);

    current[addon.key] = variantId;
    created.push(addon.title);
    const field = { top: "topVariantId", bottom: "bottomVariantId", logo: "logoVariantId", bundle: "bundleVariantId" }[addon.key];
    await prisma.store.update({ where: { shop }, data: { [field]: variantId } as Record<string, string> });
  }
  log.info("addons.created", { shop, created });
  return created;
}
