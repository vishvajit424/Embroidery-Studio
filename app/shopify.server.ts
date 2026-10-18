import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureCartTransform } from "./services/cart-transform.server";
import { getStore } from "./services/store.server";
import { syncLibrary } from "./services/library.server";
import { log } from "./services/logger.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // app/uninstalled and the privacy webhooks are declared in shopify.app.toml.
  // orders/create contains protected customer data, so it is registered per
  // shop here instead: if the app has not been granted protected customer
  // data access yet, registration fails quietly and only the order stats on
  // the dashboard are affected (a TOML subscription would block deploys).
  webhooks: {
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders-create",
    },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      const shop = session.shop;
      try {
        await getStore(shop);
        await syncLibrary(admin, shop);
      } catch (error) {
        log.error("after_auth.library_failed", { shop, error });
      }
      try {
        await ensureCartTransform(admin, shop);
      } catch (error) {
        log.error("after_auth.cart_transform_failed", { shop, error });
      }
      try {
        const result = await shopify.registerWebhooks({ session });
        const failed = Object.entries(result || {}).filter(([, r]) => (r as any[]).some((x) => !x.success));
        if (failed.length) log.warn("after_auth.webhooks_not_registered", { shop, topics: failed.map(([t]) => t) });
      } catch (error) {
        log.warn("after_auth.webhooks_failed", { shop, error });
      }
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
