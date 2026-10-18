import type { Config } from "@react-router/dev/config";

// React Router rejects form submissions whose Origin header does not match the
// request host (CSRF protection). Behind `shopify app dev` the browser posts from
// the Cloudflare tunnel while the CLI proxy forwards to localhost.
function hostOf(url: string | undefined) {
  try { return url ? new URL(url).host : ""; } catch { return ""; }
}
const appHost = hostOf(process.env.SHOPIFY_APP_URL) || hostOf(process.env.HOST);

export default {
  appDirectory: "app",
  ssr: true,
  allowedActionOrigins: [
    "*.trycloudflare.com",           // dev tunnels (the name changes every run)
    ...(appHost ? [appHost] : []),   // production domain from SHOPIFY_APP_URL
  ],
} satisfies Config;
