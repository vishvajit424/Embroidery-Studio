import { useMemo, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { defaultInput, lookupVariants, saveProductConfig, serializeConfig } from "../services/product-config.server";
import { gql } from "../services/types";
import { log } from "../services/logger.server";
import { Banners } from "../components/Banners";
import { VariantPicker } from "../components/VariantPicker";
import { PositionPreview } from "../components/PositionPreview";
import { parseOverrides, type PositionValue } from "../utils/config";
import { formatMoney } from "../utils/format";
import { isHttpsUrl, parseIntInRange, parsePrice } from "../utils/validation";

const PRODUCT_QUERY = `#graphql
query EmbroideryProduct($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    status
    featuredMedia { preview { image { url(transform: { maxWidth: 800 }) } } }
  }
}`;

function productGid(param: string | undefined) {
  if (!param || !/^\d+$/.test(param)) throw new Response("Product not found", { status: 404 });
  return `gid://shopify/Product/${param}`;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = productGid(params.id);
  const data = await gql(admin, PRODUCT_QUERY, { id });
  if (!data.product) throw new Response("Product not found", { status: 404 });

  const store = await getStore(shop);
  const row = await prisma.productEmbroideryConfig.findUnique({ where: { shop_productId: { shop, productId: id } } });
  const config = row ? serializeConfig(row) : { ...defaultInput(store), id: null, productId: id, productTitle: data.product.title, syncedAt: null, syncError: null };
  const positions = await prisma.embroideryPosition.findMany({ where: { shop, enabled: true }, orderBy: { name: "asc" } });
  const variants = await lookupVariants(admin, [
    config.topVariantId, config.bottomVariantId, config.logoVariantId, config.bundleVariantId,
    store.topVariantId, store.bottomVariantId, store.logoVariantId, store.bundleVariantId,
  ]);

  return {
    product: {
      id: data.product.id as string,
      title: data.product.title as string,
      handle: data.product.handle as string,
      status: data.product.status as string,
      image: (data.product.featuredMedia?.preview?.image?.url as string) || null,
    },
    config,
    currency: store.currencyCode,
    positions: positions.map((p) => ({ key: p.key, name: p.name, area: p.area, x: p.x, y: p.y, width: p.width, rotation: p.rotation })),
    storeAddons: { top: store.topVariantId, bottom: store.bottomVariantId, logo: store.logoVariantId, bundle: store.bundleVariantId },
    variants,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = productGid(params.id);
  const form = await request.formData();
  const store = await getStore(shop);
  const base = defaultInput(store);
  const on = (name: string) => form.get(name) !== null;
  const str = (name: string) => String(form.get(name) || "").trim();

  // Product identity comes from Shopify, never from the browser.
  const data = await gql(admin, PRODUCT_QUERY, { id });
  if (!data.product) return { ok: false, errors: ["This product no longer exists."], warnings: [] };

  const bottomImageUrl = str("bottomImageUrl");
  if (bottomImageUrl && !isHttpsUrl(bottomImageUrl)) {
    return { ok: false, errors: ["Bottom preview image must be an https:// URL."], warnings: [] };
  }

  const input = {
    enabled: on("enabled"),
    topEnabled: on("topEnabled"),
    bottomEnabled: on("bottomEnabled"),
    logoEnabled: on("logoEnabled"),
    bundleEnabled: on("bundleEnabled"),
    topPrice: parsePrice(form.get("topPrice"), base.topPrice),
    bottomPrice: parsePrice(form.get("bottomPrice"), base.bottomPrice),
    logoPrice: parsePrice(form.get("logoPrice"), base.logoPrice),
    bundlePrice: parsePrice(form.get("bundlePrice"), base.bundlePrice),
    bundleCompareAt: parsePrice(form.get("bundleCompareAt"), base.bundleCompareAt),
    topPosition: str("topPosition") || base.topPosition,
    iconPosition: str("iconPosition") || base.iconPosition,
    bottomPosition: str("bottomPosition") || base.bottomPosition,
    positionOverrides: JSON.stringify(parseOverrides(str("positionOverrides"))),
    bottomImageUrl: bottomImageUrl || null,
    uploadMaxSize: parseIntInRange(form.get("uploadMaxSize"), base.uploadMaxSize, 1, 20),
    requireName: on("requireName"),
    maxChars: parseIntInRange(form.get("maxChars"), 22, 4, 40),
    topVariantId: str("topVariantId") || null,
    bottomVariantId: str("bottomVariantId") || null,
    logoVariantId: str("logoVariantId") || null,
    bundleVariantId: str("bundleVariantId") || null,
  };

  try {
    const result = await saveProductConfig(admin, shop, {
      id,
      title: data.product.title,
      handle: data.product.handle,
      imageUrl: data.product.featuredMedia?.preview?.image?.url || null,
    }, input);
    return result;
  } catch (error) {
    log.error("product_config.save_error", { shop, productId: id, error });
    return { ok: false, errors: ["Shopify returned an error while saving. Please try again."], warnings: [] };
  }
}

function PriceRow({ name, enabledName, label, price, enabled, help }: {
  name: string; enabledName: string; label: string; price: number; enabled: boolean; help?: string;
}) {
  return (
    <s-grid gridTemplateColumns="minmax(160px, 1fr) minmax(140px, 200px)" gap="base" alignItems="center">
      <s-checkbox name={enabledName} value="on" label={label} details={help} defaultChecked={enabled} />
      <s-money-field name={name} label={`${label} price`} labelAccessibilityVisibility="exclusive" min={0} defaultValue={String(price)} />
    </s-grid>
  );
}

function PositionSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ key: string; name: string }> }) {
  return (
    <label className="es-admin-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
      </select>
    </label>
  );
}

export default function ProductConfig() {
  const { product, config, currency, positions, storeAddons, variants } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [topPosition, setTopPosition] = useState(config.topPosition);
  const [iconPosition, setIconPosition] = useState(config.iconPosition);
  const [bottomPosition, setBottomPosition] = useState(config.bottomPosition);
  const [overrides, setOverrides] = useState<Record<string, PositionValue>>(parseOverrides(config.positionOverrides));

  const byKey = useMemo(() => Object.fromEntries(positions.map((p) => [p.key, p])), [positions]);
  const resolve = (key: string): PositionValue => overrides[key] || byKey[key] || { x: 0.5, y: 0.5, width: 0.2, rotation: 0 };
  const topOptions = positions.filter((p) => p.area === "top");
  const bottomOptions = positions.filter((p) => p.area === "bottom");

  function setOverride(key: string, field: keyof PositionValue, value: number) {
    setOverrides((prev) => ({ ...prev, [key]: { ...resolve(key), [field]: value } }));
  }
  function resetOverride(key: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const addonSummary = (id: string | null | undefined) => {
    if (!id) return null;
    const v = variants[id];
    return v ? { id, title: v.title, productTitle: v.productTitle, price: v.price, image: v.image } : { id, title: "", productTitle: "Unknown variant" };
  };
  const fallback = (key: "top" | "bottom" | "logo" | "bundle") => {
    const v = storeAddons[key] ? variants[storeAddons[key] as string] : null;
    return v ? `Using shop default: ${v.productTitle}` : "Not mapped — set a shop default in Settings or pick one here";
  };
  const individualTotal = config.topPrice + config.logoPrice + config.bottomPrice;

  const editors: Array<{ key: string; label: string }> = [
    { key: topPosition, label: "Top text" },
    { key: iconPosition, label: "Icon / logo" },
    { key: bottomPosition, label: "Bottom text" },
  ];

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app/products">Products</s-link>
      <style>{`.es-admin-field{display:flex;flex-direction:column;gap:4px;font-size:13px}.es-admin-field select,.es-admin-field input{padding:6px 8px;border:1px solid #c9cccf;border-radius:8px;font:inherit;background:#fff;min-height:32px}.es-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}`}</style>
      <Form method="post">
        <s-stack gap="base">
          <Banners errors={result?.errors} warnings={result?.warnings} success={result?.ok ? "Configuration saved and published to the storefront." : null} />
          {config.syncError && !result ? <s-banner tone="critical">Last publish failed: {config.syncError}</s-banner> : null}

          <s-section heading="Embroidery">
            <s-checkbox name="enabled" value="on" label="Enable embroidery on this product" defaultChecked={config.enabled} />
          </s-section>

          <s-section heading="Options and prices">
            <s-paragraph>Prices are in your store currency ({currency}). Customers paying in other currencies see converted amounts.</s-paragraph>
            <s-stack gap="base">
              <PriceRow name="topPrice" enabledName="topEnabled" label="Top embroidery" price={config.topPrice} enabled={config.topEnabled} help="First name and designation on the top" />
              <PriceRow name="logoPrice" enabledName="logoEnabled" label="Icon / Logo" price={config.logoPrice} enabled={config.logoEnabled} help="Added to Top embroidery when an icon or logo is chosen" />
              <PriceRow name="bottomPrice" enabledName="bottomEnabled" label="Bottom embroidery" price={config.bottomPrice} enabled={config.bottomEnabled} help="Name on the bottom" />
              <PriceRow name="bundlePrice" enabledName="bundleEnabled" label="Bundle" price={config.bundlePrice} enabled={config.bundleEnabled} help="Top + icon/logo + bottom at one price" />
              <s-money-field name="bundleCompareAt" label="Bundle compare-at price" min={0} defaultValue={String(config.bundleCompareAt)}
                details={`Buying separately currently costs ${formatMoney(individualTotal, currency)}.`} />
            </s-stack>
          </s-section>

          <s-section heading="Placement and preview">
            <input type="hidden" name="topPosition" value={topPosition} />
            <input type="hidden" name="iconPosition" value={iconPosition} />
            <input type="hidden" name="bottomPosition" value={bottomPosition} />
            <input type="hidden" name="positionOverrides" value={JSON.stringify(overrides)} />
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="large">
              <s-stack gap="base">
                <PositionSelect label="Top text position" value={topPosition} onChange={setTopPosition} options={topOptions} />
                <PositionSelect label="Icon / logo position" value={iconPosition} onChange={setIconPosition} options={topOptions} />
                <PositionSelect label="Bottom text position" value={bottomPosition} onChange={setBottomPosition} options={bottomOptions} />
                {editors.map(({ key, label }) => {
                  const p = resolve(key);
                  return (
                    <s-box key={`${label}-${key}`} padding="small" border="base" borderRadius="base">
                      <s-stack gap="small-200">
                        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                          <s-text type="strong">{label}: {byKey[key]?.name || key}</s-text>
                          {overrides[key] ? <s-button variant="tertiary" onClick={() => resetOverride(key)}>Reset to library</s-button> : <s-badge>Library default</s-badge>}
                        </s-stack>
                        <div className="es-admin-grid">
                          {(["x", "y", "width", "rotation"] as const).map((field) => (
                            <label key={field} className="es-admin-field">
                              <span>{field === "rotation" ? "Rotation (°)" : `${field} (0–1)`}</span>
                              <input
                                type="number"
                                step={field === "rotation" ? 1 : 0.01}
                                min={field === "rotation" ? -180 : 0}
                                max={field === "rotation" ? 180 : 1}
                                value={p[field]}
                                onChange={(e) => setOverride(key, field, Number(e.target.value))}
                              />
                            </label>
                          ))}
                        </div>
                      </s-stack>
                    </s-box>
                  );
                })}
              </s-stack>
              <s-stack gap="small">
                <s-text type="strong">Top preview</s-text>
                <PositionPreview imageUrl={product.image} boxes={[
                  { key: "top", label: "Name", ...resolve(topPosition) },
                  { key: "icon", label: "Icon", ...resolve(iconPosition), color: "#0e7490" },
                ]} />
                <s-text color="subdued">Coordinates are relative to the image (0 = left/top, 1 = right/bottom), so they work at any image size.</s-text>
              </s-stack>
            </s-grid>
            <s-text-field name="bottomImageUrl" label="Bottom preview image URL (optional)" defaultValue={config.bottomImageUrl || ""}
              details="Shown when previewing bottom embroidery. Leave empty to use the product image." />
          </s-section>

          <s-section heading="Customer input">
            <s-stack gap="base">
              <s-checkbox name="requireName" value="on" label="Name is required" defaultChecked={config.requireName} />
              <s-number-field name="maxChars" label="Maximum characters per line" min={4} max={40} defaultValue={String(config.maxChars)} />
              <s-number-field name="uploadMaxSize" label="Logo upload limit (MB)" min={1} max={20} defaultValue={String(config.uploadMaxSize)} />
            </s-stack>
          </s-section>

          <s-section heading="Add-on variants">
            <s-paragraph>
              The Cart Transform adds these variants next to the garment at the prices above. Leave empty to use the shop defaults from Settings.
            </s-paragraph>
            <s-stack gap="small">
              <VariantPicker name="topVariantId" label="Top embroidery" initial={addonSummary(config.topVariantId)} fallbackText={fallback("top")} missing={Boolean(config.topVariantId && !variants[config.topVariantId])} />
              <VariantPicker name="bottomVariantId" label="Bottom embroidery" initial={addonSummary(config.bottomVariantId)} fallbackText={fallback("bottom")} missing={Boolean(config.bottomVariantId && !variants[config.bottomVariantId])} />
              <VariantPicker name="logoVariantId" label="Icon / Logo" initial={addonSummary(config.logoVariantId)} fallbackText={fallback("logo")} missing={Boolean(config.logoVariantId && !variants[config.logoVariantId])} />
              <VariantPicker name="bundleVariantId" label="Bundle" initial={addonSummary(config.bundleVariantId)} fallbackText={fallback("bundle")} missing={Boolean(config.bundleVariantId && !variants[config.bundleVariantId])} />
            </s-stack>
          </s-section>

          <s-section>
            <s-button type="submit" variant="primary" loading={saving}>Save configuration</s-button>
          </s-section>
        </s-stack>
      </Form>
    </s-page>
  );
}
