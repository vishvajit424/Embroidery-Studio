import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore, storeNumbers } from "../services/store.server";
import { resyncAllProducts } from "../services/product-config.server";
import { syncLibrary } from "../services/library.server";
import { log } from "../services/logger.server";
import { Banners } from "../components/Banners";
import { formatMoney } from "../utils/format";
import { parseIntInRange, parsePrice } from "../utils/validation";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getStore(session.shop);
  const configured = await prisma.productEmbroideryConfig.count({ where: { shop: session.shop } });
  return { ...storeNumbers(store), configured };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const store = await getStore(shop);
  const prices = {
    topPrice: parsePrice(form.get("topPrice"), Number(store.topPrice)),
    bottomPrice: parsePrice(form.get("bottomPrice"), Number(store.bottomPrice)),
    logoPrice: parsePrice(form.get("logoPrice"), Number(store.logoPrice)),
    bundlePrice: parsePrice(form.get("bundlePrice"), Number(store.bundlePrice)),
    bundleCompareAt: parsePrice(form.get("bundleCompareAt"), Number(store.bundleCompareAt)),
  };
  const uploadMaxMb = parseIntInRange(form.get("uploadMaxMb"), store.uploadMaxMb, 1, 20);
  await prisma.store.update({ where: { shop }, data: { ...prices, uploadMaxMb } });
  log.info("pricing.defaults_saved", { shop, ...prices });

  const warnings: string[] = [];
  if (prices.bundlePrice >= prices.topPrice + prices.logoPrice + prices.bottomPrice) {
    warnings.push("The bundle price is not lower than buying Top + Icon/Logo + Bottom separately.");
  }
  let success = "Default prices saved. They are used for products you configure from now on.";
  if (form.get("applyToAll") !== null) {
    await prisma.productEmbroideryConfig.updateMany({ where: { shop }, data: { ...prices, uploadMaxSize: uploadMaxMb } });
    const { total, failed } = await resyncAllProducts(admin, shop);
    success = `Prices applied to ${total} configured product(s).`;
    if (failed) return { errors: [`${failed} product(s) could not be published. Open them and save again.`], warnings, success: null };
  }
  try {
    await syncLibrary(admin, shop); // publishes the upload limit
  } catch (error) {
    warnings.push("Could not republish the upload limit to the storefront.");
  }
  return { errors: [], warnings, success };
}

export default function Pricing() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const total = data.topPrice + data.logoPrice + data.bottomPrice;
  return (
    <s-page heading="Pricing">
      <Banners errors={result?.errors} warnings={result?.warnings} success={result?.success} />
      <Form method="post">
        <s-section heading={`Default prices (${data.currencyCode})`}>
          <s-paragraph>
            Prices are set in your store currency. The Cart Transform converts them for customers paying in other currencies — the browser never decides the price.
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <s-money-field name="topPrice" label="Top embroidery (name + designation)" min={0} defaultValue={String(data.topPrice)} />
            <s-money-field name="logoPrice" label="Icon / Logo" min={0} defaultValue={String(data.logoPrice)} />
            <s-money-field name="bottomPrice" label="Bottom embroidery" min={0} defaultValue={String(data.bottomPrice)} />
            <s-money-field name="bundlePrice" label="Bundle" min={0} defaultValue={String(data.bundlePrice)} />
            <s-money-field name="bundleCompareAt" label="Bundle compare-at" min={0} defaultValue={String(data.bundleCompareAt)} />
            <s-number-field name="uploadMaxMb" label="Logo upload limit (MB)" min={1} max={20} defaultValue={String(data.uploadMaxMb)} />
          </s-grid>
          <s-box paddingBlockStart="base">
            <s-text color="subdued">
              Separately: {formatMoney(total, data.currencyCode)} · Bundle: {formatMoney(data.bundlePrice, data.currencyCode)} · Saving: {formatMoney(Math.max(0, total - data.bundlePrice), data.currencyCode)}
            </s-text>
          </s-box>
        </s-section>
        <s-section>
          <s-stack gap="base">
            <s-checkbox name="applyToAll" value="on" label={`Also apply these prices to all ${data.configured} configured product(s)`} />
            <s-button type="submit" variant="primary" loading={navigation.state === "submitting"}>Save pricing</s-button>
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}
