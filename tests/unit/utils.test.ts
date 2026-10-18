// Shared admin/server utilities - run with Node's type stripping (npm run test:unit)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLibrary, buildProductMetafield, configProblems, parseOverrides, type ProductConfigInput } from "../../app/utils/config.ts";
import { isSafeSvg, normalizeHex, parsePrice, sniffImageType, validateEmbroideryText, validateFileMeta, ICON_UPLOAD_TYPES } from "../../app/utils/validation.ts";

const base: ProductConfigInput = {
  enabled: true, topEnabled: true, bottomEnabled: true, logoEnabled: true, bundleEnabled: true,
  topPrice: 299, bottomPrice: 199, logoPrice: 250, bundlePrice: 598, bundleCompareAt: 748,
  topPosition: "leftChest", iconPosition: "rightChest", bottomPosition: "leftSide", positionOverrides: "{}",
  uploadMaxSize: 5, requireName: true, maxChars: 22,
};
const store = { topVariantId: "gid://shopify/ProductVariant/1", bottomVariantId: "gid://shopify/ProductVariant/2", logoVariantId: "gid://shopify/ProductVariant/3", bundleVariantId: "gid://shopify/ProductVariant/4" };

test("product metafield uses shop default add-ons and per-product overrides", () => {
  const m = buildProductMetafield({ ...base, topVariantId: "gid://shopify/ProductVariant/99" }, store);
  assert.equal(m.addons.top, "gid://shopify/ProductVariant/99");
  assert.equal(m.addons.bundle, "gid://shopify/ProductVariant/4");
  assert.equal(m.options.bundle.price, 598);
  assert.equal(m.options.bundle.compareAt, 748);
  assert.equal(m.enabled, true);
});

test("an option without an add-on variant is published as disabled", () => {
  const m = buildProductMetafield(base, { ...store, logoVariantId: null });
  assert.equal(m.options.logo.enabled, false);
  assert.ok(configProblems(base, { ...store, logoVariantId: null }).some((p) => p.includes("Logo")));
});

test("bundle requires top and bottom", () => {
  const input = { ...base, bottomEnabled: false };
  assert.equal(buildProductMetafield(input, store).options.bundle.enabled, false);
  assert.ok(configProblems(input, store).some((p) => p.includes("bundle")));
});

test("position overrides are sanitised", () => {
  assert.deepEqual(parseOverrides("not json"), {});
  assert.deepEqual(parseOverrides('{"a":{"x":2,"y":-1,"width":0,"rotation":999}}'), { a: { x: 1, y: 0, width: 0.01, rotation: 180 } });
  assert.deepEqual(parseOverrides('{"a":{"x":"nope"}}'), {});
});

test("library only publishes enabled items, in order", () => {
  const lib = buildLibrary({
    options: [{ key: "top", label: "Top", description: "", enabled: true }],
    colors: [{ id: "b", name: "B", hex: "#000000", enabled: true, sortOrder: 2 }, { id: "a", name: "A", hex: "#FFFFFF", enabled: true, sortOrder: 1 }, { id: "x", name: "X", hex: "#111111", enabled: false, sortOrder: 0 }],
    fonts: [], icons: [], positions: [{ key: "leftChest", name: "L", area: "top", x: 0.6, y: 0.3, width: 0.2, rotation: 0, enabled: true }],
    uploadMaxMb: 5,
  });
  assert.deepEqual(lib.colors.map((c) => c.id), ["a", "b"]);
  assert.equal(lib.positions.leftChest.x, 0.6);
  assert.ok(lib.positions.back, "default placements are always available");
});

test("image sniffing by magic bytes", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(sniffImageType(png), "image/png");
  assert.equal(sniffImageType(jpg), "image/jpeg");
  assert.equal(sniffImageType(webp), "image/webp");
  assert.equal(sniffImageType(svg), "image/svg+xml");
  assert.equal(sniffImageType(new TextEncoder().encode("%PDF-1.7 hello world")), null);
  assert.equal(sniffImageType(new Uint8Array([1, 2])), null);
});

test("server-side file checks", () => {
  assert.equal(validateFileMeta({ name: "a.png", type: "image/png", size: 10 }, 5), null);
  assert.match(String(validateFileMeta({ name: "a.png", type: "image/png", size: 0 }, 5)), /empty/);
  assert.match(String(validateFileMeta({ name: "a.exe", type: "image/png", size: 10 }, 5)), /Unsupported/);
  assert.match(String(validateFileMeta({ name: "a.png", type: "image/jpeg", size: 10 }, 5)), /does not match/);
  assert.match(String(validateFileMeta({ name: "a.png", type: "image/png", size: 6 * 1024 * 1024 }, 5)), /5 MB/);
  assert.match(String(validateFileMeta({ name: "a.png", type: "image/png", size: 30 * 1024 * 1024 }, 99)), /20 MB/);
  assert.equal(validateFileMeta({ name: "a.svg", type: "image/svg+xml", size: 10 }, 2, ICON_UPLOAD_TYPES), null);
  assert.ok(validateFileMeta({ name: "a.svg", type: "image/svg+xml", size: 10 }, 2));
});

test("unsafe SVGs are rejected", () => {
  assert.equal(isSafeSvg('<svg><path d="M0 0"/></svg>'), true);
  assert.equal(isSafeSvg("<svg><script>alert(1)</script></svg>"), false);
  assert.equal(isSafeSvg('<svg onload="x()"></svg>'), false);
  assert.equal(isSafeSvg('<svg><a href="javascript:x"/></svg>'), false);
});

test("prices, colours and text", () => {
  assert.equal(parsePrice("₹ 1,299.50", 0), 1299.5);
  assert.equal(parsePrice("", 7), 7);
  assert.equal(parsePrice("-", 7), 7);
  assert.equal(normalizeHex("abc"), "#AABBCC");
  assert.equal(validateEmbroideryText("", { required: true, maxChars: 22, label: "Name" }), "Name is required.");
  assert.equal(validateEmbroideryText("Dr. Asha", { required: true, maxChars: 22, label: "Name" }), null);
  assert.ok(validateEmbroideryText("<b>", { required: true, maxChars: 22, label: "Name" }));
});
