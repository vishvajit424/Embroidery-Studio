// Cart Transform function tests - run with: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { cartTransformRun, readConfig } from "../../extensions/embroidery-cart-transform/src/run.js";

const V = (n) => `gid://shopify/ProductVariant/${n}`;
const CONFIG = {
  v: 3,
  enabled: true,
  options: {
    top: { enabled: true, price: 299 },
    bottom: { enabled: true, price: 199 },
    logo: { enabled: true, price: 250 },
    bundle: { enabled: true, price: 598, compareAt: 748 },
  },
  addons: { top: V(901), bottom: V(902), logo: V(903), bundle: V(904) },
};

function line(attrs, { price = "1099.0", config = CONFIG, quantity = 1, typename = "ProductVariant", noMetafield = false } = {}) {
  const l = {
    id: "gid://shopify/CartLine/1",
    quantity,
    cost: { amountPerQuantity: { amount: price, currencyCode: "INR" } },
    merchandise: { __typename: typename, id: V(111), product: { title: "Classic Scrub Top", metafield: noMetafield ? null : { jsonValue: config } } },
  };
  for (const [k, v] of Object.entries(attrs)) l[k] = { value: v };
  return l;
}
const run = (lines, rate = "1.0") => cartTransformRun({ presentmentCurrencyRate: rate, cart: { lines } });
const items = (result) => result.operations[0].lineExpand.expandedCartItems;
const total = (result) => items(result).reduce((sum, i) => sum + Number(i.price.adjustment.fixedPricePerUnit.amount) * i.quantity, 0);

test("bundle: garment ₹1099 + bundle ₹598 = ₹1697 (not 748, 1099 or 598)", () => {
  const result = run([line({ enabled: "true", type: "bundle", firstName: "Vishvajit", bottom: "Vishvajit", icon: "Heart" })]);
  assert.equal(items(result).length, 2);
  assert.deepEqual(items(result).map((i) => i.merchandiseId), [V(111), V(904)]);
  assert.equal(total(result), 1697);
  assert.notEqual(total(result), 748);
});

test("garment price is kept exactly and never becomes zero", () => {
  const result = run([line({ enabled: "true", type: "bundle", firstName: "A" })]);
  assert.equal(items(result)[0].price.adjustment.fixedPricePerUnit.amount, "1099.00");
});

test("top without icon: garment + top", () => {
  const result = run([line({ enabled: "true", type: "top", firstName: "A" })]);
  assert.deepEqual(items(result).map((i) => i.merchandiseId), [V(111), V(901)]);
  assert.equal(total(result), 1099 + 299);
});

test("top with icon charges the icon/logo add-on", () => {
  const result = run([line({ enabled: "true", type: "top", firstName: "A", icon: "Heart" })]);
  assert.deepEqual(items(result).map((i) => i.merchandiseId), [V(111), V(901), V(903)]);
  assert.equal(total(result), 1099 + 299 + 250);
});

test("top with custom logo charges the icon/logo add-on", () => {
  const result = run([line({ enabled: "true", type: "top", firstName: "A", logo: "https://cdn.shopify.com/x.png" })]);
  assert.equal(total(result), 1099 + 299 + 250);
});

test("bundle never adds a separate logo charge", () => {
  const result = run([line({ enabled: "true", type: "bundle", firstName: "A", logo: "https://cdn.shopify.com/x.png" })]);
  assert.equal(items(result).length, 2);
});

test("bottom: garment + bottom", () => {
  const result = run([line({ enabled: "true", type: "bottom", bottom: "Kumar" })]);
  assert.deepEqual(items(result).map((i) => i.merchandiseId), [V(111), V(902)]);
  assert.equal(total(result), 1099 + 199);
});

test("component quantity is per unit (Shopify multiplies by the line quantity)", () => {
  const result = run([line({ enabled: "true", type: "bundle", firstName: "A" }, { quantity: 3 })]);
  assert.ok(items(result).every((i) => i.quantity === 1));
});

test("currency: add-on prices are converted with presentmentCurrencyRate", () => {
  const result = run([line({ enabled: "true", type: "top", firstName: "A", icon: "Heart" }, { price: "13.19" })], "0.012");
  const amounts = items(result).map((i) => i.price.adjustment.fixedPricePerUnit.amount);
  assert.deepEqual(amounts, ["13.19", "3.59", "3.00"]);
});

test("skip / not enabled: no operations", () => {
  assert.deepEqual(run([line({})]), { operations: [] });
  assert.deepEqual(run([line({ enabled: "false", type: "top" })]), { operations: [] });
});

test("unknown type is ignored", () => {
  assert.deepEqual(run([line({ enabled: "true", type: "sleeve" })]), { operations: [] });
});

test("product not enabled in the app: no change", () => {
  assert.deepEqual(run([line({ enabled: "true", type: "top" }, { config: { ...CONFIG, enabled: false } })]), { operations: [] });
});

test("option disabled or add-on not mapped: no change", () => {
  const noTop = { ...CONFIG, options: { ...CONFIG.options, top: { enabled: false, price: 299 } } };
  assert.deepEqual(run([line({ enabled: "true", type: "top" }, { config: noTop })]), { operations: [] });
  const noAddon = { ...CONFIG, addons: { ...CONFIG.addons, bottom: "" } };
  assert.deepEqual(run([line({ enabled: "true", type: "bottom" }, { config: noAddon })]), { operations: [] });
  const badGid = { ...CONFIG, addons: { ...CONFIG.addons, bundle: "not-a-gid" } };
  assert.deepEqual(run([line({ enabled: "true", type: "bundle" }, { config: badGid })]), { operations: [] });
});

test("malformed configuration never throws", () => {
  for (const config of [null, "not json", "[]", 42, { enabled: true }, { enabled: true, options: "x" }, { enabled: true, options: { top: { enabled: true, price: "abc" } }, addons: CONFIG.addons }, { enabled: true, options: { top: { enabled: true, price: -5 } }, addons: CONFIG.addons }]) {
    assert.deepEqual(run([line({ enabled: "true", type: "top" }, { config })]), { operations: [] });
  }
  assert.deepEqual(run([line({ enabled: "true", type: "top" }, { noMetafield: true })]), { operations: [] });
});

test("malformed input never throws", () => {
  assert.deepEqual(cartTransformRun({}), { operations: [] });
  assert.deepEqual(cartTransformRun({ cart: { lines: [null, { id: "x" }, 5] } }), { operations: [] });
  assert.deepEqual(run([line({ enabled: "true", type: "top" }, { typename: "CustomProduct" })]), { operations: [] });
  assert.deepEqual(run([line({ enabled: "true", type: "top" }, { price: "abc" })]), { operations: [] });
  const weird = line({ enabled: "true", type: "top" });
  weird.type = { value: 7 };
  assert.deepEqual(run([weird]), { operations: [] });
});

test("config as a JSON string is accepted", () => {
  assert.deepEqual(readConfig({ jsonValue: JSON.stringify(CONFIG) }), CONFIG);
  const result = run([line({ enabled: "true", type: "bottom" }, { config: JSON.stringify(CONFIG) })]);
  assert.equal(items(result).length, 2);
});

test("embroidery attributes are copied onto expanded items", () => {
  const result = run([line({ enabled: "true", type: "top", firstName: "Asha", color: "Gold (#C9A227)", summary: "Top Embroidery · Top: Asha" })]);
  const keys = items(result)[1].attributes.map((a) => a.key);
  assert.ok(keys.includes("_embroidery_first_name"));
  assert.ok(keys.includes("_embroidery_color"));
  assert.ok(keys.includes("Embroidery"));
});

test("several embroidered lines are each expanded", () => {
  const a = line({ enabled: "true", type: "top", firstName: "A" });
  const b = { ...line({ enabled: "true", type: "bottom", bottom: "B" }), id: "gid://shopify/CartLine/2" };
  const c = { ...line({}), id: "gid://shopify/CartLine/3" };
  const result = run([a, b, c]);
  assert.equal(result.operations.length, 2);
});

test("title keeps the product name", () => {
  const result = run([line({ enabled: "true", type: "top", firstName: "A" })]);
  assert.equal(result.operations[0].lineExpand.title, "Classic Scrub Top + Embroidery");
});
