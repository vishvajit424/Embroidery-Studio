import { Form, useActionData, useLoaderData } from "react-router";
import type { ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { ensureCartTransform, getCartTransformStatus } from "../services/cart-transform.server";
import { syncLibrary } from "../services/library.server";
import { gql } from "../services/types";
import { log } from "../services/logger.server";
import { numericId } from "../utils/format";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  let store = await getStore(shop);

  // Keep the shop currency current for admin price display.
  try {
    const data = await gql(admin, `#graphql
      query EmbroideryShop { shop { currencyCode } }`);
    const currencyCode = data.shop?.currencyCode;
    if (currencyCode && currencyCode !== store.currencyCode) {
      store = await prisma.store.update({ where: { shop }, data: { currencyCode } });
    }
  } catch (error) {
    log.warn("dashboard.shop_query_failed", { shop, error });
  }

  if (!store.librarySyncedAt) {
    try {
      await syncLibrary(admin, shop);
      store = await getStore(shop);
    } catch (error) {
      log.warn("dashboard.library_sync_failed", { shop, error });
    }
  }

  const [enabledProducts, totalConfigurations, lines, recent] = await Promise.all([
    prisma.productEmbroideryConfig.count({ where: { shop, enabled: true } }),
    prisma.productEmbroideryConfig.count({ where: { shop } }),
    prisma.embroideryOrderLine.groupBy({ by: ["type", "orderId"], where: { shop } }),
    prisma.embroideryOrderLine.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const orders = { top: 0, bottom: 0, bundle: 0 };
  for (const row of lines) {
    if (row.type === "top" || row.type === "bottom" || row.type === "bundle") orders[row.type] += 1;
  }

  const cartTransform = await ensureCartTransform(admin, shop);
  const addonsMapped = [store.topVariantId, store.bottomVariantId, store.logoVariantId, store.bundleVariantId].filter(Boolean).length;

  return {
    shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    stats: { enabledProducts, totalConfigurations, ...orders },
    recent: recent.map((r) => ({ id: r.id, orderId: r.orderId, orderName: r.orderName, type: r.type, quantity: r.quantity, hasLogo: r.hasLogo, createdAt: r.createdAt.toISOString() })),
    cartTransform,
    addonsMapped,
    librarySyncedAt: store.librarySyncedAt?.toISOString() || null,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  await ensureCartTransform(admin, session.shop);
  return { cartTransform: await getCartTransformStatus(admin) };
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" minInlineSize="150px">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{String(value)}</s-heading>
      </s-stack>
    </s-box>
  );
}

function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-badge tone={done ? "success" : "warning"}>{done ? "Done" : "To do"}</s-badge>
      <s-text>{children}</s-text>
    </s-stack>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const cartTransform = actionData?.cartTransform || data.cartTransform;
  const themeEditorUrl = `https://${data.shop}/admin/themes/current/editor?template=product&addAppBlockId=${data.apiKey}/embroidery&target=mainSection`;

  return (
    <s-page heading="Embroidery Studio">
      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <Stat label="Enabled products" value={data.stats.enabledProducts} />
          <Stat label="Total configurations" value={data.stats.totalConfigurations} />
          <Stat label="Top embroidery orders" value={data.stats.top || 0} />
          <Stat label="Bottom embroidery orders" value={data.stats.bottom || 0} />
          <Stat label="Bundle orders" value={data.stats.bundle || 0} />
        </s-stack>
      </s-section>

      <s-section heading="Setup checklist">
        <s-stack gap="small">
          <Step done={data.addonsMapped === 4}>
            Add-on products mapped ({data.addonsMapped}/4) — <s-link href="/app/settings">Settings</s-link>
          </Step>
          <Step done={cartTransform.active}>Embroidery pricing (Cart Transform) active</Step>
          <Step done={Boolean(data.librarySyncedAt)}>
            Design library published — <s-link href="/app/library">Design library</s-link>
          </Step>
          <Step done={data.stats.enabledProducts > 0}>
            At least one product enabled — <s-link href="/app/products">Products</s-link>
          </Step>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone="info">Theme</s-badge>
            <s-text>
              Add the <s-text type="strong">Embroidery Studio</s-text> block to your product template —{" "}
              <s-link href={themeEditorUrl} target="_blank">Open theme editor</s-link>
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Embroidery pricing">
        {cartTransform.active ? (
          <s-banner tone="success">Active — embroidery add-ons are priced by the Cart Transform function.</s-banner>
        ) : (
          <s-banner tone="critical">
            {cartTransform.functionFound
              ? "The pricing function is deployed but not active on this store, so embroidery is not being charged."
              : "The pricing function was not found. Run `shopify app deploy` (or `shopify app dev`) and reload."}
            {cartTransform.error ? ` (${cartTransform.error})` : ""}
          </s-banner>
        )}
        {!cartTransform.active && cartTransform.functionFound ? (
          <Form method="post">
            <s-button type="submit" variant="primary">Activate embroidery pricing</s-button>
          </Form>
        ) : null}
      </s-section>

      <s-section heading="Recent embroidered orders">
        {data.recent.length === 0 ? (
          <s-paragraph>
            No embroidered orders recorded yet. Order stats need the orders/create webhook, which requires protected customer data access
            (Partner Dashboard → your app → API access → Protected customer data).
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Qty</s-table-header>
              <s-table-header>Logo</s-table-header>
              <s-table-header>Date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.recent.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${numericId(r.orderId)}`}>{r.orderName || numericId(r.orderId)}</s-link>
                  </s-table-cell>
                  <s-table-cell>{r.type}</s-table-cell>
                  <s-table-cell>{r.quantity}</s-table-cell>
                  <s-table-cell>{r.hasLogo ? "Yes" : "—"}</s-table-cell>
                  <s-table-cell>{new Date(r.createdAt).toLocaleDateString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
