import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../services/store.server";
import { log } from "../services/logger.server";

/**
 * Mandatory privacy webhooks. Personalisation text lives on Shopify orders
 * (line-item properties); this app stores no customer names or contact data,
 * only anonymous per-line embroidery types and the uploaded logo files'
 * metadata. customers/data_request and customers/redact therefore have
 * nothing to return/erase here; shop/redact removes everything for the shop.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop } = await authenticate.webhook(request);
  if (topic === "SHOP_REDACT") await deleteShopData(shop);
  log.info("privacy.webhook", { shop, topic });
  return new Response(null, { status: 200 });
}
