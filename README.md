# Embroidery Studio

A reusable Shopify app that adds a custom-embroidery experience to any product: customers pick **Bundle**, **Top** or **Bottom** embroidery, enter their name and designation, choose a thread colour, font and icon (or upload their own logo), see a live preview on the product image, confirm, and add to cart. Embroidery is charged by a **Cart Transform function**, so the browser never decides the price.

Works on any Online Store 2.0 theme (Dawn, Refresh, Sense, Craft, Prestige, Impulse and custom themes) via a Theme App Extension block. No ScriptTags, no theme file edits.

---

## Contents

1. [How it works](#how-it-works)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Development](#development)
5. [Theme setup](#theme-setup)
6. [Cart Transform setup](#cart-transform-setup)
7. [Product configuration](#product-configuration)
8. [Build and deploy](#build-and-deploy)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)
11. [Project structure](#project-structure)

---

## How it works

```
Merchant ─▶ Admin app ─▶ Database (Prisma) ─▶ metafields ─▶ Theme block (customer UI)
                                                  │                 │
                                                  │                 ▼
                                                  │        line-item properties
                                                  │                 │
                                                  └──────▶ Cart Transform ─▶ Cart ─▶ Checkout ─▶ Order
```

| Piece | What it does |
|---|---|
| **Admin app** (`app/`) | Products, pricing, icon/font/colour/placement libraries, add-on products, uploads, dashboard. |
| **Product metafield** `$app:embroidery.config` | Per-product options, prices, placements, add-on variant IDs. Written by the app through the Admin API; read by the theme block and the function. |
| **App metafield** `embroidery.library` | Shop-wide colours, fonts, icons, placements and option labels. Read in Liquid as `app.metafields.embroidery.library`. |
| **Theme block** (`extensions/embroidery-theme`) | The customer UI: option picker, editor with live preview, logo upload, confirmation screen. Writes line-item properties into the theme's own product form. |
| **Cart Transform** (`extensions/embroidery-cart-transform`) | Expands each embroidered line into the garment (at its own price) **plus** dedicated add-on variants at the configured prices. |
| **App proxy** `/apps/embroidery-studio/upload` | Receives customer logos, validates them and stores them in Shopify Files. |

### Pricing model

The garment is never discounted or re-priced. Embroidery is charged through four dedicated add-on products:

| Choice | Cart shows | Example |
|---|---|---|
| Top | garment + *Embroidery — Top* (+ *Icon / Logo* if an icon or logo is chosen) | ₹1099 + ₹299 (+ ₹250) |
| Bottom | garment + *Embroidery — Bottom* | ₹1099 + ₹199 |
| Bundle | garment + *Embroidery — Bundle* (icon/logo included) | ₹1099 + ₹598 = **₹1697** |

Prices are configured in the shop currency. The function converts them with Shopify's `presentmentCurrencyRate`, and the storefront displays them in the customer's currency.

### Cart / order data

Hidden properties (read by the function, shown in the order admin):
`_embroidery_enabled`, `_embroidery_type`, `_embroidery_top`, `_embroidery_bottom`, `_embroidery_first_name`, `_embroidery_second_name`, `_embroidery_color`, `_embroidery_font`, `_embroidery_icon`, `_embroidery_logo`, `_embroidery_upload_id`, `_embroidery_positions`, `_embroidery_variant_id`, `_embroidery_config_version`.

Visible to the customer in cart and order: **Embroidery** (a one-line summary) and **Embroidery logo** (the uploaded file's URL).

No price is sent from the browser.

---

## Prerequisites

- **Node.js 22.12+** (`node -v`)
- **Shopify CLI 3.x**: `npm install -g @shopify/cli` (the package is `@shopify/cli`, not `@shopify/shopify-cli`). It is also a dev dependency, so `npx shopify` works.
- A [Shopify Partner account](https://partners.shopify.com) and a **development store**.
- Git (recommended).

---

## Installation

```bash
npm install
(cd extensions/embroidery-cart-transform && npm install)
cp .env.example .env        # only needed outside `shopify app dev`
```

**If npm prints "install scripts blocked … not covered by allowScripts"** (newer npm versions do this), approve the packages that need their install scripts, then install again:

```bash
npm install-scripts approve @prisma/client @prisma/engines prisma esbuild
npm install
npx prisma generate
```

Without this, the Prisma client is never generated (`Module '"@prisma/client"' has no exported member 'PrismaClient'` plus many "implicitly has an 'any' type" errors), and Vite can't build because esbuild's binary is missing. `prisma` and `@prisma/client` must be the same version; `npm ls prisma @prisma/client` shows both.

### Link the app

This repository is already linked to the Partner app `embroidery-studio-app` (`shopify.app.embroidery-studio-app.toml`). To use it:

```bash
shopify app config use shopify.app.embroidery-studio-app.toml
```

To link your own app instead, run `shopify app config link` and let the CLI write a new `shopify.app.<name>.toml`. Then copy over the `[access_scopes]`, `[webhooks]`, `[app_proxy]` and `[product.metafields…]` sections. Never hand-write client IDs, extension UIDs or function IDs; always let the CLI generate them.

### Environment variables

`shopify app dev` injects these automatically. Set them yourself in production:

| Variable | Example |
|---|---|
| `SHOPIFY_API_KEY` | Client ID from the Partner Dashboard |
| `SHOPIFY_API_SECRET` | Client secret (server only; never sent to the storefront) |
| `SHOPIFY_APP_URL` | `https://embroidery.example.com` |
| `SCOPES` | `read_products,write_products,write_files,read_orders,write_cart_transforms` |
| `DATABASE_URL` | `file:./dev.db` (SQLite) or a PostgreSQL/MySQL URL |

### Database / Prisma

```bash
npx prisma generate
npx prisma migrate deploy     # creates dev.db from prisma/migrations
```

**Production database:** change `provider` in `prisma/schema.prisma` to `"postgresql"` (or `"mysql"`), set `DATABASE_URL`, delete `prisma/migrations`, then run `npx prisma migrate dev --name init` once to generate migrations for that database. The schema only uses portable column types.

### Function types

The Cart Transform needs its GraphQL schema and generated types. The CLI usually creates these on build; to generate them manually:

```bash
cd extensions/embroidery-cart-transform
npm run schema     # writes schema.graphql
npm run typegen    # writes generated/api.ts
```

---

## Development

```bash
shopify app dev
```

Choose your development store and open the app from the URL the CLI prints. On first load the app:

1. creates the shop record and seeds the default library (9 colours, 6 fonts, 9 original medical icons, 10 placements);
2. publishes the library to the storefront;
3. activates the Cart Transform;
4. registers the `orders/create` webhook (for dashboard stats).

---

## Theme setup

1. **Online Store → Themes → Customize → Products → Default product.**
2. **Add block → Apps → Embroidery Studio**, and drag it above the Add-to-cart button.
3. In the block settings you can change the heading, description (`[price]` becomes the lowest embroidery price), button labels, confirmation title, delivery message, returns/terms message, an optional "I understand" checkbox, and the accent colours.

The dashboard's **Open theme editor** link opens the product template with the block ready to add.

The block finds the theme's add-to-cart form on its own. It looks for the closest form containing a `name="id"` input, whether that is inside a `<product-form>` or elsewhere in the section. It never changes the selected variant: the variant is read from the form when the customer adds to cart. If a theme re-renders its form (for example on variant change), the block puts its inputs back before submission.

---

## Cart Transform setup

1. **Add-on products.** Go to **Settings → Create missing add-on products automatically**. This creates *Embroidery — Top / Bottom / Icon / Logo / Bundle*, tagged `embroidery-addon`, price 0, untracked, no shipping, and sets them as the shop defaults. Make sure they are **Active** and available on the **Online Store** sales channel. You can also create them yourself and pick them with the variant picker.
2. **Activation.** A deployed function does nothing until it is activated per shop with `cartTransformCreate` (scope `write_cart_transforms`). The app does this after install. The dashboard shows *Active*; if it doesn't, click **Activate embroidery pricing**.

---

## Product configuration

**Products** lists every product (search and pagination; add-on products are hidden). From there you can:

- **Enable / Disable** with one click. Enabling checks that the needed add-on variants exist.
- **Configure** a product:
  - turn Top / Bottom / Icon-Logo / Bundle on or off, and set their prices and the bundle compare-at price;
  - choose where the top text, icon and bottom text are placed, with a live preview and per-product fine-tuning (x, y, width and rotation, relative to the image);
  - set whether the name is required, the maximum characters, and the logo upload size limit;
  - override the add-on variants for this product (the app verifies they exist).

Every save validates the configuration, writes it to the database and publishes it to the product metafield.

Shop-wide libraries:

| Page | Purpose |
|---|---|
| **Design library** | Overview, option names and descriptions shown to customers, "Publish now". |
| **Icons** | Upload SVG/PNG/JPG/WebP icons (stored in Shopify Files; unsafe SVGs rejected), set placement, enable, reorder. Single-colour icons on transparent backgrounds are recoloured with the thread colour. |
| **Fonts** | Name, CSS font-family, optional https stylesheet (e.g. Google Fonts), preview text, enable, reorder. |
| **Colors** | Name + hex, enable, reorder. |
| **Preview settings** | Placement library (Left/Right Chest, Center Chest, sleeves, bottom Left/Right Side, Back, custom). |
| **Pricing** | Default prices and upload limit for new products; optionally apply them to all configured products. |
| **Uploads** | Customer logos with status, size, preview and link. |

---

## Build and deploy

```bash
shopify version
shopify app config validate
shopify app build
npm run check
npm test
```

Then test on the development store with `shopify app dev` (see the checklist below). Only when everything passes:

```bash
shopify app deploy        # releases the theme block + Cart Transform
npm run build && npm run setup && npm run start   # on your server
```

Before deploying to production, set `application_url`, `redirect_urls` and `[app_proxy] url` in the TOML to your domain. `shopify app dev` updates them automatically, but only during development.

**Order statistics** use the `orders/create` webhook, which needs **protected customer data access** (Partner Dashboard → App → API access → Protected customer data). Without it, everything else still works and the dashboard shows 0 orders. For this reason the webhook is registered by the app, not in the TOML, so it cannot block deploys.

---

## Testing

```bash
npm run test:unit   # Cart Transform, storefront logic, validation/config utilities (node:test)
npm run test:e2e    # Chromium against a mock Dawn-like product page (needs: npx playwright install chromium)
npm run check       # TypeScript/GraphQL/Liquid/JSON static checks
npm run typecheck   # full TypeScript type check (after npm install)
```

The automated tests cover:

- **Pricing:** bundle ₹1099 + ₹598 = ₹1697, top, top with icon, top with logo, bottom, currency conversion.
- **Malformed input:** attributes and configuration that are missing or broken never throw.
- **Customer flow:** skip, remove, edit (every value restored), variant change after configuring, and the preview following the variant image.
- **Validation:** required, maximum length and allowed characters.
- **Logo upload:** invalid, oversized, empty, slow processing (polled), failed, and remove/re-upload.
- **Other:** focus trap and Esc, theme form re-render, and no horizontal overflow at 320/375/390/430/768/1024/1440 px.

### Manual checklist (development store)

- [ ] Product without embroidery · with embroidery
- [ ] Top · Bottom · Bundle · name only · name + designation
- [ ] Icon · logo · icon + text · bottom text · colour · font
- [ ] Edit · Skip · Remove
- [ ] Variant change · quantity change
- [ ] Multiple products · multiple embroidered products in one cart
- [ ] Mobile · desktop · a second currency (Markets)
- [ ] Cart shows garment + add-on at the right prices · checkout total
- [ ] Order admin shows the properties and the logo link
- [ ] Upload failure · invalid file · oversized file

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **"Cannot find valid organization"** | `shopify auth logout`, then `shopify app dev` and log in with the Partner account that owns the app. Or run `shopify app config link` to link your own app. |
| **Invalid extension configuration** | Run `shopify app config validate`. Keep the CLI-generated `uid` values. If you generated a fresh extension with `shopify app generate extension`, copy only the `src/` files into it. |
| **Function build failure** | Run `npm install` inside `extensions/embroidery-cart-transform`, then `npm run schema && npm run typegen`. The entry file is `src/index.js`; the JavaScript export `cartTransformRun` maps to the TOML export `cart-transform-run` (TOML exports must be kebab-case); and `[extensions.build] command` must stay empty for JavaScript functions. |
| **Theme Check failure / warning** | `embroidery.js` is about 13 KB gzipped, just over Theme Check's 10 KB *suggestion* for app-block JavaScript. This is a warning and does not block deploys; minify the file if you want it gone. |
| **`Module "@prisma/client" has no exported member 'PrismaClient'`** (and many implicit-any errors) | The Prisma client was not generated, usually because npm blocked install scripts. Run `npm install-scripts approve @prisma/client @prisma/engines prisma esbuild`, then `npm install` and `npx prisma generate`. |
| **Missing scope** (`Access denied for cartTransformCreate / fileCreate`) | Reinstall or re-approve the app so it gets `write_cart_transforms`, `write_files` and `read_orders`. Check `SCOPES` in production. |
| **Cart Transform not installed** (no embroidery charge in cart) | Dashboard → **Activate embroidery pricing**. Also check that the add-on variants are mapped (Settings) and the add-on products are Active on the Online Store. |
| **Variant mismatch** | The block never writes the `id` input. If the cart shows the wrong size, the theme is changing variants outside its form. Compare `_embroidery_variant_id` in the order with the ordered variant; they match whenever the theme submits its form normally. |
| **Upload failure** | Check that the app proxy exists (Partner Dashboard → App → App proxy: prefix `apps`, subpath `embroidery-studio`) and that the block's "App proxy path" matches. Check the server logs for `upload.failed`. Large files: limit is per product (1–20 MB). |
| Block doesn't appear on a product | In the theme editor, a note explains why. Usually the product is not enabled, or an option has no add-on variant. |
| Icons show as solid squares | The icon image has a solid background. Use transparent PNG/SVG/WebP (icons are drawn as colour masks). |

Logs are JSON lines (`{"level","event","shop",…}`). Tokens, secrets and customer names are redacted automatically.

---

## Project structure

```
app/
  routes/            dashboard, products, products.$id, library, icons, fonts, colors,
                     pricing, preview-settings, uploads, settings, upload (app proxy),
                     auth, webhooks
  services/          store, library + product sync, Shopify Files, add-ons, orders,
                     cart-transform activation, logger, rate limiting
  components/        Banners, VariantPicker, PositionPreview, RowActions
  utils/             pure, unit-tested: defaults, validation, config builders, formatting
extensions/
  embroidery-theme/  blocks/embroidery.liquid, assets/embroidery.{js,css}, icon SVGs
  embroidery-cart-transform/  src/run.graphql, src/run.js, src/index.js
prisma/              schema.prisma, migrations/
tests/unit/          node:test suites
tests/e2e/           mock storefront + Playwright scenarios
scripts/check.mjs    offline static checks
```

All icons, UI and code are original. The reference store was used only as a functional guide.
