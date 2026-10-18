import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../services/store.server";
import { log } from "../services/logger.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate.webhook(request);
  // Idempotent: the webhook can be delivered more than once.
  await deleteShopData(shop);
  log.info("app.uninstalled", { shop });
  return new Response(null, { status: 200 });
}
