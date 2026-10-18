// Storefront pure logic (extensions/embroidery-theme/assets/embroidery.js)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load the theme asset exactly as written (a classic script, not a module).
const source = fs.readFileSync(path.join(__dirname, "../../extensions/embroidery-theme/assets/embroidery.js"), "utf8");
const sandbox = { module: { exports: {} }, Intl, Array, Number, String, Math, JSON, Object, RegExp };
vm.runInNewContext(source, sandbox, { filename: "embroidery.js" });
// Objects created inside the sandbox have a different prototype; return plain copies.
const plain = (fn) => (...args) => { const r = fn(...args); return r && typeof r === "object" ? JSON.parse(JSON.stringify(r)) : r; };
const Core = Object.fromEntries(Object.entries(sandbox.module.exports).map(([k, v]) => [k, typeof v === "function" && k !== "makeMoney" ? plain(v) : v]));

const config = {
  enabled: true, requireName: true, maxChars: 22, uploadMaxMb: 5,
  options: { top: { enabled: true, price: 299 }, bottom: { enabled: true, price: 199 }, logo: { enabled: true, price: 250 }, bundle: { enabled: true, price: 598, compareAt: 748 } },
  positions: { top: "leftChest", icon: "rightChest", bottom: "leftSide" },
  positionOverrides: { leftChest: { x: 0.7, y: 0.3, width: 0.2, rotation: 0 } },
};
const library = {
  options: { bundle: { label: "Embroidery Bundle" }, top: { label: "Top Embroidery" }, bottom: { label: "Bottom Embroidery" } },
  colors: [{ id: "c1", name: "Gold", hex: "#C9A227" }, { id: "c2", name: "White", hex: "#FFFFFF" }],
  fonts: [{ id: "f1", name: "Block", family: "Impact" }, { id: "f2", name: "Script", family: "cursive" }],
  icons: [{ id: "i1", name: "Heart", image: "asset:icon-heart.svg", placement: "top" }],
  positions: { leftChest: { x: 0.64, y: 0.33, width: 0.2, rotation: 0 }, rightChest: { x: 0.36, y: 0.33, width: 0.09, rotation: 0 } },
};
const state = (over) => ({ type: "top", firstName: "Vishvajit", secondName: "Software Developer", bottomName: "", colorId: "c1", fontId: "f2", iconId: "", logo: null, ...over });

test("prices", () => {
  assert.equal(Core.priceFor(state(), config), 299);
  assert.equal(Core.priceFor(state({ iconId: "i1" }), config), 549);
  assert.equal(Core.priceFor(state({ logo: { url: "https://cdn/x.png", status: "ready" } }), config), 549);
  assert.equal(Core.priceFor(state({ type: "bottom" }), config), 199);
  assert.equal(Core.priceFor(state({ type: "bundle", iconId: "i1" }), config), 598);
  assert.equal(Core.priceFor(state({ type: "" }), config), 0);
  assert.equal(Core.startingPrice(config), 199);
});

test("only enabled options are offered", () => {
  const c = { ...config, options: { ...config.options, bundle: { enabled: false, price: 598 } } };
  assert.deepEqual(Core.availableTypes(c), ["top", "bottom"]);
  assert.deepEqual(Core.availableTypes({}), []);
});

test("currency formatting uses the customer currency, not always INR", () => {
  assert.match(Core.makeMoney("INR", 1, "en-IN")(598), /₹\s?598/);
  const usd = Core.makeMoney("USD", 0.012, "en-US")(598);
  assert.match(usd, /^\$7\.18$/);
  assert.doesNotMatch(Core.makeMoney("AED", 0.044, "en")(598), /₹/);
});

test("file validation: empty, type, extension, size", () => {
  const f = (name, type, size) => ({ name, type, size });
  assert.equal(Core.validateFile(f("logo.png", "image/png", 1000), 5), "");
  assert.equal(Core.validateFile(f("logo.jpeg", "image/jpeg", 1000), 5), "");
  assert.equal(Core.validateFile(f("logo.webp", "image/webp", 1000), 5), "");
  assert.match(Core.validateFile(f("logo.png", "image/png", 0), 5), /empty/);
  assert.match(Core.validateFile(f("logo.gif", "image/gif", 10), 5), /PNG, JPG/);
  assert.match(Core.validateFile(f("logo.png", "application/pdf", 10), 5), /valid PNG/);
  assert.match(Core.validateFile(f("logo.png", "image/png", 6 * 1024 * 1024), 5), /5 MB/);
  assert.equal(Core.validateFile(f("logo.png", "image/png", 6 * 1024 * 1024), 10), "");
  assert.match(Core.validateFile(null, 5), /choose/);
});

test("validation: required names, max length, allowed characters", () => {
  assert.deepEqual(Core.validateState(state(), config, library), {});
  assert.ok(Core.validateState(state({ firstName: " " }), config, library).firstName);
  assert.ok(Core.validateState(state({ firstName: "x".repeat(23) }), config, library).firstName);
  assert.ok(Core.validateState(state({ firstName: "<script>" }), config, library).firstName);
  assert.deepEqual(Core.validateState(state({ firstName: "Dr. José O'Neil-Smith" }), config, library), {});
  assert.ok(Core.validateState(state({ type: "bottom", bottomName: "" }), config, library).bottomName);
  assert.ok(Core.validateState(state({ type: "bundle", bottomName: "" }), config, library).bottomName);
  assert.deepEqual(Core.validateState(state({ firstName: "" }), { ...config, requireName: false }, library), {});
});

test("validation: colour, font, icon and upload state", () => {
  assert.ok(Core.validateState(state({ colorId: "nope" }), config, library).color);
  assert.ok(Core.validateState(state({ fontId: "nope" }), config, library).font);
  assert.ok(Core.validateState(state({ iconId: "nope" }), config, library).icon);
  assert.ok(Core.validateState(state({ logo: { status: "uploading" } }), config, library).logo);
  assert.ok(Core.validateState(state({ logo: { status: "error", error: "x" } }), config, library).logo);
  assert.ok(Core.validateState(state({ type: "sleeve" }), config, library).type);
});

test("cart properties: top with icon", () => {
  const p = Core.buildProperties(state({ iconId: "i1" }), config, library, "222");
  assert.equal(p._embroidery_enabled, "true");
  assert.equal(p._embroidery_type, "top");
  assert.equal(p._embroidery_first_name, "Vishvajit");
  assert.equal(p._embroidery_second_name, "Software Developer");
  assert.equal(p._embroidery_top, "Vishvajit | Software Developer");
  assert.equal(p._embroidery_icon, "Heart");
  assert.equal(p._embroidery_color, "Gold (#C9A227)");
  assert.equal(p._embroidery_font, "Script");
  assert.equal(p._embroidery_variant_id, "222");
  assert.equal(p._embroidery_config_version, "3");
  assert.equal(p._embroidery_bottom, undefined, "empty values are omitted");
  assert.equal(p._embroidery_price, undefined, "no client price is sent");
  assert.match(p.Embroidery, /Top Embroidery · Top: Vishvajit \/ Software Developer · Colour: Gold · Font: Script · Icon: Heart/);
});

test("cart properties: logo replaces icon; bottom has no top fields", () => {
  const withLogo = Core.buildProperties(state({ iconId: "i1", logo: { url: "https://cdn.shopify.com/l.png", uploadId: "u1", status: "ready" } }), config, library, "1");
  assert.equal(withLogo._embroidery_logo, "https://cdn.shopify.com/l.png");
  assert.equal(withLogo["Embroidery logo"], "https://cdn.shopify.com/l.png");
  assert.equal(withLogo._embroidery_icon, undefined);
  const bottom = Core.buildProperties(state({ type: "bottom", bottomName: "Kumar", iconId: "i1" }), config, library, "1");
  assert.equal(bottom._embroidery_bottom, "Kumar");
  assert.equal(bottom._embroidery_first_name, undefined);
  assert.equal(bottom._embroidery_icon, undefined);
});

test("skip produces no properties", () => {
  assert.deepEqual(Core.buildProperties(null, config, library, "1"), {});
  assert.deepEqual(Core.buildProperties(state({ type: "" }), config, library, "1"), {});
});

test("positions: per-product override wins, then library, then a safe default", () => {
  assert.equal(Core.resolvePosition("leftChest", config, library).x, 0.7);
  assert.equal(Core.resolvePosition("rightChest", config, library).width, 0.09);
  assert.deepEqual(Core.resolvePosition("unknown", config, library), { x: 0.5, y: 0.35, width: 0.2, rotation: 0 });
});
