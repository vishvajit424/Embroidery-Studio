import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { syncLibrary, withLibrarySync } from "../services/library.server";
import { log } from "../services/logger.server";
import { Banners } from "../components/Banners";
import { OPTION_KEYS } from "../utils/defaults";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const store = await getStore(shop);
  const [options, icons, fonts, colors, positions] = await Promise.all([
    prisma.embroideryOption.findMany({ where: { shop }, orderBy: { sortOrder: "asc" } }),
    prisma.embroideryIcon.count({ where: { shop, enabled: true } }),
    prisma.embroideryFont.count({ where: { shop, enabled: true } }),
    prisma.embroideryColor.count({ where: { shop, enabled: true } }),
    prisma.embroideryPosition.count({ where: { shop, enabled: true } }),
  ]);
  return {
    options: options.map((o) => ({ key: o.key, label: o.label, description: o.description, enabled: o.enabled })),
    counts: { icons, fonts, colors, positions },
    librarySyncedAt: store.librarySyncedAt?.toISOString() || null,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  if (form.get("intent") === "publish") {
    try {
      await syncLibrary(admin, shop);
      return { success: "Library published to the storefront.", errors: [] };
    } catch (error) {
      log.error("library.publish_failed", { shop, error });
      return { errors: ["Publishing failed. Please try again."] };
    }
  }
  const syncError = await withLibrarySync(admin, shop, async () => {
    for (const key of OPTION_KEYS) {
      const label = String(form.get(`${key}.label`) || "").trim().slice(0, 60);
      const description = String(form.get(`${key}.description`) || "").trim().slice(0, 160);
      if (!label) continue;
      await prisma.embroideryOption.update({ where: { shop_key: { shop, key } }, data: { label, description } });
    }
  });
  log.info("options.updated", { shop });
  return { success: "Option texts saved.", errors: syncError ? [syncError] : [] };
}

function Card({ title, count, href, text }: { title: string; count: number; href: string; text: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-heading>{title}</s-heading>
        <s-text color="subdued">{count} enabled · {text}</s-text>
        <s-link href={href}>Manage {title.toLowerCase()}</s-link>
      </s-stack>
    </s-box>
  );
}

export default function Library() {
  const { options, counts, librarySyncedAt } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <s-page heading="Design library">
      <Banners errors={result?.errors} success={result && "success" in result ? result.success : null} />
      <s-section heading="Shared across all products">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          <Card title="Icons" count={counts.icons} href="/app/icons" text="image assets customers can add" />
          <Card title="Fonts" count={counts.fonts} href="/app/fonts" text="text styles" />
          <Card title="Colors" count={counts.colors} href="/app/colors" text="thread colour swatches" />
          <Card title="Placements" count={counts.positions} href="/app/preview-settings" text="preview positions" />
        </s-grid>
        <s-box paddingBlockStart="base">
          <Form method="post">
            <input type="hidden" name="intent" value="publish" />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button type="submit">Publish library now</s-button>
              <s-text color="subdued">{librarySyncedAt ? `Last published ${new Date(librarySyncedAt).toLocaleString()}` : "Not published yet"}</s-text>
            </s-stack>
          </Form>
        </s-box>
      </s-section>
      <s-section heading="Option names shown to customers">
        <Form method="post">
          <input type="hidden" name="intent" value="options" />
          <s-stack gap="base">
            {options.map((o) => (
              <s-grid key={o.key} gridTemplateColumns="minmax(160px, 1fr) minmax(220px, 2fr)" gap="small">
                <s-text-field name={`${o.key}.label`} label={`${o.key[0].toUpperCase()}${o.key.slice(1)} — name`} defaultValue={o.label} />
                <s-text-field name={`${o.key}.description`} label="Description" defaultValue={o.description} />
              </s-grid>
            ))}
            <s-button type="submit" variant="primary" loading={navigation.state === "submitting"}>Save option texts</s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
