import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { createAddonProducts } from "../services/addons.server";
import { ensureCartTransform, getCartTransformStatus } from "../services/cart-transform.server";
import { lookupVariants, resyncAllProducts } from "../services/product-config.server";
import { syncLibrary } from "../services/library.server";
import { log } from "../services/logger.server";
import { Banners } from "../components/Banners";
import { VariantPicker } from "../components/VariantPicker";
import { isShopifyGid } from "../utils/validation";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getStore(session.shop);
  const ids = { top: store.topVariantId, bottom: store.bottomVariantId, logo: store.logoVariantId, bundle: store.bundleVariantId };
  const variants = await lookupVariants(admin, Object.values(ids));
  const cartTransform = await getCartTransformStatus(admin);
  return { shop: session.shop, apiKey: process.env.SHOPIFY_API_KEY || "", ids, variants, cartTransform };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  try {
    if (intent === "createAddons") {
      const created = await createAddonProducts(admin, shop);
      const { failed } = await resyncAllProducts(admin, shop);
      return { success: created.length ? `Created: ${created.join(", ")}.` : "All add-on products already exist.", errors: failed ? [`${failed} product(s) could not be republished.`] : [] };
    }
    if (intent === "saveAddons") {
      const picked = {
        topVariantId: String(form.get("topVariantId") || "") || null,
        bottomVariantId: String(form.get("bottomVariantId") || "") || null,
        logoVariantId: String(form.get("logoVariantId") || "") || null,
        bundleVariantId: String(form.get("bundleVariantId") || "") || null,
      };
      const ids = Object.values(picked).filter(Boolean) as string[];
      if (ids.some((id) => !isShopifyGid(id, "ProductVariant"))) return { errors: ["Invalid variant."] };
      const found = await lookupVariants(admin, ids);
      const missing = ids.filter((id) => !found[id]);
      if (missing.length) return { errors: ["One or more selected variants no longer exist in Shopify."] };
      await prisma.store.update({ where: { shop }, data: picked });
      const { total, failed } = await resyncAllProducts(admin, shop);
      log.info("settings.addons_saved", { shop });
      return { success: `Add-on variants saved and ${total} product(s) republished.`, errors: failed ? [`${failed} product(s) could not be republished.`] : [] };
    }
    if (intent === "activate") {
      const status = await ensureCartTransform(admin, shop);
      return status.active ? { success: "Embroidery pricing is active.", errors: [] } : { errors: [status.error || "Could not activate the pricing function."] };
    }
    if (intent === "resync") {
      await syncLibrary(admin, shop);
      const { total, failed } = await resyncAllProducts(admin, shop);
      return { success: `Library and ${total} product(s) republished.`, errors: failed ? [`${failed} product(s) failed.`] : [] };
    }
  } catch (error) {
    log.error("settings.action_failed", { shop, intent, error });
    return { errors: [error instanceof Error ? error.message : "Something went wrong."] };
  }
  return { errors: ["Unknown action."] };
}

export default function Settings() {
  const { shop, apiKey, ids, variants, cartTransform } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = (intent: string) => navigation.state === "submitting" && navigation.formData?.get("intent") === intent;
  const summary = (id: string | null) => (id ? (variants[id] ? { id, title: variants[id].title, productTitle: variants[id].productTitle, price: variants[id].price } : { id, title: "", productTitle: "Missing variant" }) : null);
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/embroidery&target=mainSection`;

  return (
    <s-page heading="Settings">
      <Banners errors={result?.errors} success={result && "success" in result ? result.success : null} />

      <s-section heading="Add-on products (shop defaults)">
        <s-paragraph>
          Embroidery is charged by adding these dedicated add-on variants next to the garment in the cart, so the garment keeps its own price.
          Products use these unless they choose their own on their configuration page.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="createAddons" />
          <s-button type="submit" loading={busy("createAddons")}>Create missing add-on products automatically</s-button>
        </Form>
        <s-box paddingBlockStart="base">
          <Form method="post">
            <input type="hidden" name="intent" value="saveAddons" />
            <s-stack gap="small">
              <VariantPicker name="topVariantId" label="Top embroidery" initial={summary(ids.top)} missing={Boolean(ids.top && !variants[ids.top])} />
              <VariantPicker name="bottomVariantId" label="Bottom embroidery" initial={summary(ids.bottom)} missing={Boolean(ids.bottom && !variants[ids.bottom])} />
              <VariantPicker name="logoVariantId" label="Icon / Logo" initial={summary(ids.logo)} missing={Boolean(ids.logo && !variants[ids.logo])} />
              <VariantPicker name="bundleVariantId" label="Bundle" initial={summary(ids.bundle)} missing={Boolean(ids.bundle && !variants[ids.bundle])} />
              <s-button type="submit" variant="primary" loading={busy("saveAddons")}>Save add-on variants</s-button>
            </s-stack>
          </Form>
        </s-box>
        <s-box paddingBlockStart="base">
          <s-text color="subdued">
            Add-on products must be Active and available on your Online Store sales channel. Their own price is ignored — the Cart Transform sets it.
          </s-text>
        </s-box>
      </s-section>

      <s-section heading="Embroidery pricing (Cart Transform)">
        <s-stack gap="small">
          <s-badge tone={cartTransform.active ? "success" : "critical"}>{cartTransform.active ? "Active" : cartTransform.functionFound ? "Not active" : "Function not deployed"}</s-badge>
          {!cartTransform.active ? (
            <Form method="post">
              <input type="hidden" name="intent" value="activate" />
              <s-button type="submit" loading={busy("activate")}>Activate</s-button>
            </Form>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Storefront">
        <s-stack gap="small">
          <s-paragraph>
            Add the Embroidery Studio block to your product template: <s-link href={themeEditorUrl} target="_blank">open the theme editor</s-link>.
            Texts such as the heading, button labels, delivery message and return notice are edited in the block settings.
          </s-paragraph>
          <s-paragraph>
            Customer logos are uploaded through the app proxy at <s-text type="strong">/apps/embroidery-studio/upload</s-text>. If you change the proxy path in
            your app settings, update “App proxy path” in the block settings too.
          </s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="resync" />
            <s-button type="submit" loading={busy("resync")}>Republish library and all products</s-button>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}
