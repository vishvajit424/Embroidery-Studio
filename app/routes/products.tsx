import { Form, Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { setProductEnabled } from "../services/product-config.server";
import { ADDON_TAG } from "../services/addons.server";
import { gql } from "../services/types";
import { log } from "../services/logger.server";
import { formatMoney, numericId } from "../utils/format";
import { isShopifyGid } from "../utils/validation";

const PAGE_SIZE = 20;

// ~20 products x small fields: far below the 1,000-point query cost limit.
const PRODUCTS_QUERY = `#graphql
query EmbroideryProductList($first: Int, $last: Int, $after: String, $before: String, $query: String) {
  products(first: $first, last: $last, after: $after, before: $before, sortKey: TITLE, query: $query) {
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    nodes {
      id
      title
      handle
      status
      featuredMedia { preview { image { url(transform: { maxWidth: 120 }) } } }
    }
  }
}`;

function buildQuery(search: string) {
  const parts = [`NOT tag:${ADDON_TAG}`];
  const cleaned = search.replace(/["\\]/g, " ").trim();
  if (cleaned) parts.push(`title:*${cleaned}*`);
  return parts.join(" AND ");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const store = await getStore(shop);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const onlyEnabled = url.searchParams.get("filter") === "enabled";

  if (onlyEnabled) {
    // Enabled products come from the database (paginated by offset).
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const where = { shop, enabled: true, ...(q ? { productTitle: { contains: q } } : {}) };
    const [rows, total] = await Promise.all([
      prisma.productEmbroideryConfig.findMany({ where, orderBy: { productTitle: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.productEmbroideryConfig.count({ where }),
    ]);
    return {
      currency: store.currencyCode,
      q,
      onlyEnabled,
      page,
      pageInfo: { hasNextPage: page * PAGE_SIZE < total, hasPreviousPage: page > 1, startCursor: "", endCursor: "" },
      products: rows.map((r) => ({
        id: r.productId, title: r.productTitle, handle: r.productHandle, status: "", image: r.imageUrl,
        config: { enabled: r.enabled, topPrice: Number(r.topPrice), bottomPrice: Number(r.bottomPrice), bundlePrice: Number(r.bundlePrice), syncError: r.syncError },
      })),
    };
  }

  const variables = before
    ? { last: PAGE_SIZE, before, query: buildQuery(q) }
    : { first: PAGE_SIZE, after, query: buildQuery(q) };
  const data = await gql(admin, PRODUCTS_QUERY, variables);
  const nodes: any[] = data.products.nodes;
  const configs = await prisma.productEmbroideryConfig.findMany({ where: { shop, productId: { in: nodes.map((n) => n.id) } } });
  const byId = new Map(configs.map((c) => [c.productId, c]));

  return {
    currency: store.currencyCode,
    q,
    onlyEnabled,
    page: 1,
    pageInfo: data.products.pageInfo,
    products: nodes.map((n) => {
      const c = byId.get(n.id);
      return {
        id: n.id as string,
        title: n.title as string,
        handle: n.handle as string,
        status: n.status as string,
        image: (n.featuredMedia?.preview?.image?.url as string) || null,
        config: c
          ? { enabled: c.enabled, topPrice: Number(c.topPrice), bottomPrice: Number(c.bottomPrice), bundlePrice: Number(c.bundlePrice), syncError: c.syncError }
          : null,
      };
    }),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const productId = String(form.get("productId") || "");
  if (!isShopifyGid(productId, "Product")) return { productId, ok: false, errors: ["Invalid product."] };
  const enabled = form.get("intent") === "enable";
  try {
    const result = await setProductEnabled(admin, session.shop, productId, enabled, {
      title: String(form.get("title") || ""),
      handle: String(form.get("handle") || ""),
      imageUrl: String(form.get("image") || "") || null,
    });
    return { productId, ...result };
  } catch (error) {
    log.error("products.toggle_failed", { shop: session.shop, productId, error });
    return { productId, ok: false, errors: ["Shopify returned an error. Please try again."] };
  }
}

function ToggleButton({ product }: { product: any }) {
  const fetcher = useFetcher<typeof action>();
  const enabled = product.config?.enabled;
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  return (
    <s-stack gap="small-200">
      <fetcher.Form method="post">
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="title" value={product.title} />
        <input type="hidden" name="handle" value={product.handle} />
        <input type="hidden" name="image" value={product.image || ""} />
        <input type="hidden" name="intent" value={enabled ? "disable" : "enable"} />
        <s-stack direction="inline" gap="small">
          <s-button type="submit" loading={busy} variant={enabled ? "secondary" : "primary"}>{enabled ? "Disable" : "Enable"}</s-button>
          <s-button href={`/app/products/${numericId(product.id)}`}>Configure</s-button>
        </s-stack>
      </fetcher.Form>
      {result && !result.ok ? (
        <s-text tone="critical">{result.errors?.[0]} <Link to={`/app/products/${numericId(product.id)}`}>Configure</Link></s-text>
      ) : null}
    </s-stack>
  );
}

export default function Products() {
  const { products, pageInfo, q, currency, onlyEnabled, page } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const money = (n?: number) => (n === undefined ? "—" : formatMoney(n, currency));

  const nextHref = onlyEnabled
    ? `/app/products?filter=enabled&q=${encodeURIComponent(q)}&page=${page + 1}`
    : `/app/products?q=${encodeURIComponent(q)}&after=${encodeURIComponent(pageInfo.endCursor || "")}`;
  const prevHref = onlyEnabled
    ? `/app/products?filter=enabled&q=${encodeURIComponent(q)}&page=${page - 1}`
    : `/app/products?q=${encodeURIComponent(q)}&before=${encodeURIComponent(pageInfo.startCursor || "")}`;

  return (
    <s-page heading="Products">
      <s-section>
        <Form method="get">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-search-field name="q" label="Search products" labelAccessibilityVisibility="exclusive" placeholder="Search by title" defaultValue={q} />
            <s-select name="filter" label="Show" labelAccessibilityVisibility="exclusive" value={params.get("filter") || "all"}>
              <s-option value="all">All products</s-option>
              <s-option value="enabled">Embroidery enabled</s-option>
            </s-select>
            <s-button type="submit">Search</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header>Product</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Embroidery</s-table-header>
            <s-table-header format="currency">Top</s-table-header>
            <s-table-header format="currency">Bottom</s-table-header>
            <s-table-header format="currency">Bundle</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.map((p) => (
              <s-table-row key={p.id}>
                <s-table-cell>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    {p.image ? <s-thumbnail src={p.image} alt="" size="small" /> : <s-thumbnail alt="" size="small" />}
                    <s-link href={`/app/products/${numericId(p.id)}`}>{p.title}</s-link>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{p.status ? <s-badge>{p.status.toLowerCase()}</s-badge> : "—"}</s-table-cell>
                <s-table-cell>
                  {p.config?.enabled ? <s-badge tone="success">Enabled</s-badge> : <s-badge>Off</s-badge>}
                  {p.config?.syncError ? <s-badge tone="critical">Sync error</s-badge> : null}
                </s-table-cell>
                <s-table-cell>{money(p.config?.topPrice)}</s-table-cell>
                <s-table-cell>{money(p.config?.bottomPrice)}</s-table-cell>
                <s-table-cell>{money(p.config?.bundlePrice)}</s-table-cell>
                <s-table-cell><ToggleButton product={p} /></s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {products.length === 0 ? <s-box padding="base"><s-text color="subdued">No products found.</s-text></s-box> : null}
      </s-section>

      <s-section>
        <s-stack direction="inline" gap="base">
          {pageInfo.hasPreviousPage ? <s-button href={prevHref}>Previous</s-button> : null}
          {pageInfo.hasNextPage ? <s-button href={nextHref}>Next</s-button> : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}
