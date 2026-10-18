import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordOrder } from "../services/orders.server";
import { log } from "../services/logger.server";
import prisma from "../db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload } = await authenticate.webhook(request);
  try {
    const store = await prisma.store.findUnique({ where: { shop } });
    if (store) await recordOrder(shop, payload);
  } catch (error) {
    // Never make Shopify retry forever for a stats-only webhook.
    log.error("orders.record_failed", { shop, error });
  }
  return new Response(null, { status: 200 });
}
