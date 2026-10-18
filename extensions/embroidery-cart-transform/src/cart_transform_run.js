// @ts-check
/**
 * Embroidery Studio - Cart Transform (target: cart.transform.run)
 *
 * Authoritative embroidery pricing. For every cart line carrying embroidery
 * properties, the line is expanded into:
 *   - the original garment variant at its own current price (never changed), plus
 *   - the dedicated embroidery add-on variant(s) at the prices configured for
 *     that product in the app (product metafield $app:embroidery.config).
 *
 * Prices sent by the browser are ignored. The function is deterministic,
 * makes no network calls and treats every input as untrusted: anything
 * missing or malformed results in "no change" for that line, never an error.
 */

/** @typedef {import("../generated/api").RunInput} RunInput */
/** @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult */

const NO_CHANGES = { operations: [] };

/** Query alias -> line-item property key (copied onto the expanded items). */
const ATTRIBUTES = {
  enabled: "_embroidery_enabled",
  type: "_embroidery_type",
  top: "_embroidery_top",
  bottom: "_embroidery_bottom",
  firstName: "_embroidery_first_name",
  secondName: "_embroidery_second_name",
  color: "_embroidery_color",
  font: "_embroidery_font",
  icon: "_embroidery_icon",
  logo: "_embroidery_logo",
  uploadId: "_embroidery_upload_id",
  positions: "_embroidery_positions",
  variantId: "_embroidery_variant_id",
  version: "_embroidery_config_version",
  summary: "Embroidery",
  logoUrl: "Embroidery logo",
};

const TYPES = ["top", "bottom", "bundle"];
const MAX_PRICE = 1000000;

/**
 * @param {RunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const lines = input && input.cart && Array.isArray(input.cart.lines) ? input.cart.lines : [];
  const rate = positiveNumber(input && input.presentmentCurrencyRate, 1);
  const operations = [];

  for (const line of lines) {
    try {
      const operation = transformLine(line, rate);
      if (operation) operations.push(operation);
    } catch (_error) {
      // Fail safe: an unexpected shape on one line must never block checkout.
    }
  }
  return operations.length ? { operations } : NO_CHANGES;
}

/** @returns {object | null} a lineExpand operation, or null for no change */
export function transformLine(line, rate) {
  if (!line || !line.merchandise || line.merchandise.__typename !== "ProductVariant") return null;
  if (attr(line, "enabled") !== "true") return null;

  const type = attr(line, "type");
  if (!TYPES.includes(type)) return null;

  const config = readConfig(line.merchandise.product && line.merchandise.product.metafield);
  if (!config || config.enabled !== true) return null;

  const garmentPrice = Number(line.cost && line.cost.amountPerQuantity && line.cost.amountPerQuantity.amount);
  if (!Number.isFinite(garmentPrice) || garmentPrice < 0) return null;

  const addons = config.addons || {};
  const option = (key) => {
    const o = config.options && config.options[key];
    const price = Number(o && o.price);
    return o && o.enabled === true && Number.isFinite(price) && price >= 0 && price <= MAX_PRICE ? price : null;
  };
  const isVariantGid = (id) => typeof id === "string" && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id);

  const attributes = copiedAttributes(line);
  // The garment keeps its own current price - it is never discounted or zeroed.
  const items = [expandedItem(line.merchandise.id, garmentPrice, attributes)];

  if (type === "bundle") {
    const price = option("bundle");
    if (price === null || !isVariantGid(addons.bundle)) return null;
    items.push(expandedItem(addons.bundle, price * rate, attributes));
  } else if (type === "top") {
    const price = option("top");
    if (price === null || !isVariantGid(addons.top)) return null;
    items.push(expandedItem(addons.top, price * rate, attributes));
    // Icon or custom logo on the top is a paid extra (included in the bundle).
    if (attr(line, "icon") || attr(line, "logo")) {
      const logoPrice = option("logo");
      if (logoPrice !== null && isVariantGid(addons.logo)) {
        items.push(expandedItem(addons.logo, logoPrice * rate, attributes));
      }
    }
  } else {
    const price = option("bottom");
    if (price === null || !isVariantGid(addons.bottom)) return null;
    items.push(expandedItem(addons.bottom, price * rate, attributes));
  }

  const productTitle = line.merchandise.product && typeof line.merchandise.product.title === "string"
    ? line.merchandise.product.title
    : "";
  return {
    lineExpand: {
      cartLineId: line.id,
      expandedCartItems: items,
      title: productTitle ? `${productTitle.slice(0, 200)} + Embroidery` : "Embroidered item",
    },
  };
}

/** Parses the product metafield defensively (jsonValue may be anything). */
export function readConfig(metafield) {
  if (!metafield) return null;
  let value = metafield.jsonValue;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function expandedItem(merchandiseId, amount, attributes) {
  return {
    merchandiseId,
    // Per ONE unit of the parent line: Shopify multiplies by the line quantity.
    quantity: 1,
    price: { adjustment: { fixedPricePerUnit: { amount: money(amount) } } },
    attributes,
  };
}

function money(amount) {
  const value = Math.round(Number(amount) * 100) / 100;
  return (Number.isFinite(value) && value >= 0 ? value : 0).toFixed(2);
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function attr(line, alias) {
  const entry = line[alias];
  return entry && typeof entry.value === "string" ? entry.value.trim() : "";
}

function copiedAttributes(line) {
  const out = [];
  for (const alias of Object.keys(ATTRIBUTES)) {
    const value = attr(line, alias);
    if (value) out.push({ key: ATTRIBUTES[alias], value: value.slice(0, 1000) });
  }
  return out;
}
