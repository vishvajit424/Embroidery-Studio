// Mock storefront for the Embroidery Studio block (used by storefront.spec.cjs).
// Serves a Dawn-like product page whose block data is produced by the app's
// real config builders, plus a mock app-proxy upload endpoint and /cart/add.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProductMetafield, buildLibrary } from "../../app/utils/config.ts";
import { DEFAULT_COLORS, DEFAULT_FONTS, DEFAULT_ICONS, DEFAULT_OPTIONS, DEFAULT_POSITIONS } from "../../app/utils/defaults.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, "../../extensions/embroidery-theme/assets");

export const config = buildProductMetafield({
  enabled: true, topEnabled: true, bottomEnabled: true, logoEnabled: true, bundleEnabled: true,
  topPrice: 299, bottomPrice: 199, logoPrice: 250, bundlePrice: 598, bundleCompareAt: 748,
  topPosition: "leftChest", iconPosition: "rightChest", bottomPosition: "leftSide", positionOverrides: "{}",
  bottomImageUrl: null, uploadMaxSize: 5, requireName: true, maxChars: 22,
  topVariantId: "gid://shopify/ProductVariant/901", bottomVariantId: "gid://shopify/ProductVariant/902",
  logoVariantId: "gid://shopify/ProductVariant/903", bundleVariantId: "gid://shopify/ProductVariant/904",
}, {});

export const library = buildLibrary({
  options: DEFAULT_OPTIONS.map((o) => ({ ...o, enabled: true })),
  colors: DEFAULT_COLORS.map((c, i) => ({ id: `c${i}`, ...c, enabled: true, sortOrder: i })),
  fonts: DEFAULT_FONTS.map((f, i) => ({ id: `f${i}`, name: f.name, cssFamily: f.cssFamily, stylesheetUrl: null, enabled: true, sortOrder: i })),
  icons: DEFAULT_ICONS.map((ic, i) => ({ id: `i${i}`, name: ic.name, imageUrl: `asset:${ic.file}`, placement: ic.placement, enabled: true, sortOrder: i })),
  positions: DEFAULT_POSITIONS.map((p) => ({ ...p, enabled: true })),
  uploadMaxMb: 5,
});

const productImage = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 480"><rect width="400" height="480" fill="#f1eef5"/><path d="M120 60 L165 40 Q200 70 235 40 L280 60 L360 130 L320 180 L290 155 L290 440 L110 440 L110 155 L80 180 L40 130 Z" fill="#6b2140"/></svg>');
const variantImageL = productImage.replace("6b2140", "1f4e79");

function page(currency, rate) {
  const data = {
    productId: 555,
    currency: "INR",
    image: productImage,
    variants: [{ id: 111, image: productImage }, { id: 222, image: variantImageL }],
    assets: Object.fromEntries(DEFAULT_ICONS.map((i) => [i.file, `/assets/${i.file}`])),
    config, library,
    text: {
      heading: "CUSTOM EMBROIDERY", description: "Starting at [price] — personalise your product",
      add: "Add Embroidery", skip: "Skip for Now", skipped: "No embroidery will be added.", edit: "Edit", remove: "Remove",
      chooseTitle: "Choose your embroidery", confirmTitle: "Here's your final personalised look!",
      delivery: "Embroidery orders take an additional 2-4 business days for dispatch.",
      terms: "Since they are customised just for you, embroidered items are not eligible for return or exchange.",
      requireAck: false, ackLabel: "I understand", goBack: "GO BACK", confirm: "CONFIRM", proxyPath: "/apps/embroidery-studio",
    },
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/embroidery.css">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}.grid{display:grid;gap:24px}@media(min-width:900px){.grid{grid-template-columns:1fr 1fr}}</style>
<script>window.Shopify={currency:{active:${JSON.stringify(currency)},rate:${JSON.stringify(String(rate))}}};window.cartPosts=[];</script>
</head><body>
<div id="shopify-section-main" class="shopify-section"><section class="grid">
  <div><img src="${productImage}" alt="" style="width:100%"></div>
  <div class="product-info">
    <h1>Classic Scrub Top</h1>
    <label>Size <select id="size"><option value="111">M</option><option value="222">L</option></select></label>
    <div class="es-root" data-es-root style="--es-accent:#3F3380;--es-accent-text:#FFFFFF;">
      <div class="es-card" data-es-card></div>
      <script type="application/json" data-es-data>${JSON.stringify(data)}</script>
    </div>
    <product-form>
      <form id="product-form-1" action="/cart/add" method="post" enctype="multipart/form-data">
        <input type="hidden" name="id" value="111">
        <input type="hidden" name="quantity" value="1">
        <button type="submit" name="add">Add to cart</button>
      </form>
    </product-form>
  </div>
</section></div>
<script>
  // Dawn-like behaviour: variant picker writes the hidden id; AJAX add-to-cart.
  document.getElementById('size').addEventListener('change', function (e) {
    var input = document.querySelector('#product-form-1 [name="id"]');
    input.value = e.target.value;
    input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  document.getElementById('product-form-1').addEventListener('submit', function (e) {
    e.preventDefault();
    fetch('/cart/add.js', {method: 'POST', body: new FormData(e.target)}).then(function (r) { return r.json(); }).then(function (j) { window.cartPosts.push(j); });
  });
</script>
<script src="/assets/embroidery.js" defer></script>
</body></html>`;
}

function readBody(req) {
  return new Promise((resolve) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
}

export function start(port = 0) {
  let pendingPolls = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(page(url.searchParams.get("currency") || "INR", url.searchParams.get("rate") || "1.0"));
    }
    if (url.pathname.startsWith("/assets/")) {
      const file = path.join(assets, path.basename(url.pathname));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      const type = file.endsWith(".css") ? "text/css; charset=utf-8" : file.endsWith(".js") ? "text/javascript" : "image/svg+xml";
      res.writeHead(200, { "content-type": type });
      return res.end(fs.readFileSync(file));
    }
    if (url.pathname === "/apps/embroidery-studio/upload") {
      if (req.method === "GET") {
        pendingPolls += 1;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(pendingPolls >= 2 ? { ok: true, uploadId: url.searchParams.get("id"), url: "https://cdn.example.com/logo-pending.png", status: "READY" } : { ok: true, status: "PENDING" }));
      }
      const body = (await readBody(req)).toString("latin1");
      const name = /filename="([^"]+)"/.exec(body)?.[1] || "";
      res.writeHead(200, { "content-type": "application/json" });
      if (name.startsWith("fail")) return res.end(JSON.stringify({ ok: false, error: "We couldn't upload your logo. Please try again." }));
      if (name.startsWith("slow")) { pendingPolls = 0; return res.end(JSON.stringify({ ok: true, uploadId: "up_slow", url: null, status: "PENDING" })); }
      return res.end(JSON.stringify({ ok: true, uploadId: "up_1", url: "https://cdn.example.com/logo.png", status: "READY" }));
    }
    if (url.pathname === "/cart/add.js" && req.method === "POST") {
      const raw = (await readBody(req)).toString("latin1");
      const fields = {};
      for (const m of raw.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)) fields[m[1]] = m[2];
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(fields));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start(Number(process.env.PORT || 4455)).then((s) => console.log("mock storefront on", s.address()));
}
