import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";

// `shopify app dev` passes the tunnel URL as HOST; the app expects SHOPIFY_APP_URL.
if (process.env.HOST && (!process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL === process.env.HOST)) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;

const hmrConfig =
  host === "localhost"
    ? { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 }
    : { protocol: "wss", host, port: parseInt(process.env.FRONTEND_PORT || "", 10) || 8002, clientPort: 443 };

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    allowedHosts: [host],
    cors: { preflightContinue: true },
    hmr: hmrConfig,
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [reactRouter()],
  build: { target: "es2022", assetsInlineLimit: 0 },
  optimizeDeps: { include: ["@shopify/app-bridge-react"] },
}) satisfies UserConfig;
