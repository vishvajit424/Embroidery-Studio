/**
 * A deployed Cart Transform function does nothing until it is activated on
 * each shop with `cartTransformCreate` (scope: write_cart_transforms).
 */
import { gql, userErrorsMessage, type AdminGraphql } from "./types";
import { log } from "./logger.server";

const FUNCTION_TITLES = ["Embroidery Cart Pricing", "embroidery-cart-transform"];

const STATUS_QUERY = `#graphql
query EmbroideryCartTransformStatus {
  shopifyFunctions(first: 25, apiType: "cart_transform") { nodes { id title apiType } }
  cartTransforms(first: 25) { nodes { id functionId } }
}`;

const CREATE_MUTATION = `#graphql
mutation EmbroideryCartTransformCreate($functionId: String!) {
  cartTransformCreate(functionId: $functionId, blockOnFailure: false) {
    cartTransform { id functionId }
    userErrors { field message }
  }
}`;

export type CartTransformStatus = { functionFound: boolean; active: boolean; functionId?: string; error?: string };

export async function getCartTransformStatus(admin: AdminGraphql): Promise<CartTransformStatus> {
  try {
    const data = await gql(admin, STATUS_QUERY);
    const functions: Array<{ id: string; title: string }> = data.shopifyFunctions?.nodes || [];
    const fn = functions.find((f) => FUNCTION_TITLES.includes(f.title)) || (functions.length === 1 ? functions[0] : undefined);
    if (!fn) return { functionFound: false, active: false };
    const transforms: Array<{ functionId: string }> = data.cartTransforms?.nodes || [];
    return { functionFound: true, active: transforms.some((t) => t.functionId === fn.id), functionId: fn.id };
  } catch (error) {
    return { functionFound: false, active: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function ensureCartTransform(admin: AdminGraphql, shop?: string): Promise<CartTransformStatus> {
  const status = await getCartTransformStatus(admin);
  if (!status.functionFound || status.active || !status.functionId) return status;
  try {
    const data = await gql(admin, CREATE_MUTATION, { functionId: status.functionId });
    const errors = userErrorsMessage(data.cartTransformCreate?.userErrors);
    if (errors) {
      log.error("cart_transform.activate_failed", { shop, errors });
      return { ...status, error: errors };
    }
    log.info("cart_transform.activated", { shop, functionId: status.functionId });
    return { ...status, active: true };
  } catch (error) {
    log.error("cart_transform.activate_failed", { shop, error });
    return { ...status, error: error instanceof Error ? error.message : String(error) };
  }
}
