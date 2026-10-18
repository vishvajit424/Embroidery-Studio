import prisma from "../db.server";
import { log } from "./logger.server";

type WebhookLineItem = {
  id?: number | string;
  admin_graphql_api_id?: string;
  product_id?: number | string | null;
  quantity?: number;
  properties?: Array<{ name: string; value: unknown }> | null;
};

/** Stores one row per embroidered line from an orders/create payload.
 * Only the embroidery type is stored - never names or other personal data. */
export async function recordOrder(shop: string, payload: any) {
  const lines: WebhookLineItem[] = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const orderId = String(payload?.admin_graphql_api_id || payload?.id || "");
  const orderName = String(payload?.name || "");
  let recorded = 0;

  for (const line of lines) {
    const props = new Map((line.properties || []).map((p) => [String(p.name), String(p.value ?? "")]));
    if (props.get("_embroidery_enabled") !== "true") continue;
    const type = props.get("_embroidery_type") || "";
    if (!["top", "bottom", "bundle"].includes(type)) continue;
    const lineItemId = String(line.admin_graphql_api_id || line.id || "");
    if (!lineItemId) continue;
    await prisma.embroideryOrderLine.upsert({
      where: { shop_lineItemId: { shop, lineItemId } },
      update: {},
      create: {
        shop,
        orderId,
        orderName,
        lineItemId,
        productId: line.product_id ? `gid://shopify/Product/${line.product_id}` : null,
        type,
        quantity: Number(line.quantity) || 1,
        hasLogo: Boolean(props.get("_embroidery_logo")),
      },
    });
    recorded += 1;
  }
  if (recorded) log.info("orders.recorded", { shop, orderName, lines: recorded });
  return recorded;
}
