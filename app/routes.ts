import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Shopify opens the app at "/?shop=...&host=..." - redirect into /app.
  index("routes/_index.tsx"),

  route("app", "routes/app.tsx", [
    index("routes/dashboard.tsx"),
    route("products", "routes/products.tsx"),
    route("products/:id", "routes/products.$id.tsx"),
    route("library", "routes/library.tsx"),
    route("icons", "routes/icons.tsx"),
    route("fonts", "routes/fonts.tsx"),
    route("colors", "routes/colors.tsx"),
    route("pricing", "routes/pricing.tsx"),
    route("preview-settings", "routes/preview-settings.tsx"),
    route("uploads", "routes/uploads.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),

  // Storefront logo upload, reached through the app proxy
  // (https://{shop}/apps/embroidery-studio/upload -> /proxy/upload).
  route("proxy/upload", "routes/upload.tsx"),

  route("auth/login", "routes/auth.login.tsx"),
  route("auth/*", "routes/auth.$.tsx"),
  route("api/auth/*", "routes/api.auth.$.tsx"),
  route("webhooks/app-uninstalled", "routes/webhooks.app-uninstalled.tsx"),
  route("webhooks/compliance", "routes/webhooks.compliance.tsx"),
  route("webhooks/orders-create", "routes/webhooks.orders-create.tsx"),
] satisfies RouteConfig;
