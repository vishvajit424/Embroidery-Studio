# Embroidery Studio — architecture

## Data flow

1. **Admin** (React Router + Polaris web components) stores everything in Prisma:
   `Store`, `ProductEmbroideryConfig`, `EmbroideryOption`, `EmbroideryIcon`,
   `EmbroideryFont`, `EmbroideryColor`, `EmbroideryPosition`, `Upload`,
   `EmbroideryOrderLine`.
2. On every change the app publishes JSON to Shopify:
   - `$app:embroidery.config` on the product (`utils/config.ts → buildProductMetafield`)
   - `embroidery.library` on the app installation (`buildLibrary`)
3. The **theme block** renders both into a `<script type="application/json">` and
   `embroidery.js` builds the UI. Pure logic lives in the script's `Core` and is unit-tested.
4. On **CONFIRM** the block appends `properties[...]` hidden inputs to the theme's own
   product form. The variant input is never touched; `_embroidery_variant_id` is
   refreshed at submit time from the form's current `id`.
5. The **Cart Transform** reads the line attributes and the product metafield and
   returns a `lineExpand`: garment at its own price + add-on variant(s) at fixed prices
   (× `presentmentCurrencyRate`). Invalid or missing data returns no operation for that line.
6. **orders/create** records anonymous per-line stats for the dashboard.

## Uploads

Browser → `POST /apps/embroidery-studio/upload` (app proxy, HMAC-verified by
`authenticate.public.appProxy`) → validation (extension, MIME, magic bytes, size,
empty, rate limit) → `stagedUploadsCreate` → staged POST → `fileCreate` → CDN URL.
If Shopify is still processing, the browser polls `GET …/upload?id=`.
Confirmation is blocked until the upload is ready.

## Security

- Prices come only from the product metafield inside the function.
- Product IDs in admin actions are re-read from the Admin API; add-on variant IDs
  are verified with a `nodes` query before saving.
- All admin routes use `authenticate.admin`; webhooks use `authenticate.webhook`;
  the upload endpoint uses the signed app proxy.
- Merchant SVG icons are rejected if they contain scripts or event handlers.
- Logs are structured JSON with secrets and customer text redacted.
