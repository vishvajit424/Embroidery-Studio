import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { withLibrarySync } from "../services/library.server";
import { moveItem, nextSortOrder, ownedBy } from "../services/library-crud.server";
import { log } from "../services/logger.server";
import { Banners } from "../components/Banners";
import { RowActions } from "../components/RowActions";
import { isHttpsUrl } from "../utils/validation";

/** CSS font-family values only: names, quotes, commas, spaces, hyphens. */
const FAMILY = /^[\p{L}\p{N} ,'"\-]{1,200}$/u;

function readFont(form: FormData) {
  const name = String(form.get("name") || "").trim().slice(0, 40);
  const cssFamily = String(form.get("cssFamily") || "").trim();
  const stylesheetUrl = String(form.get("stylesheetUrl") || "").trim();
  const previewText = String(form.get("previewText") || "").trim().slice(0, 40) || "Your Name";
  const errors: string[] = [];
  if (!name) errors.push("Font name is required.");
  if (!FAMILY.test(cssFamily)) errors.push("CSS font-family may only contain font names, quotes, commas and hyphens.");
  if (stylesheetUrl && !isHttpsUrl(stylesheetUrl)) errors.push("Stylesheet URL must start with https://");
  return { errors, data: { name, cssFamily, stylesheetUrl: stylesheetUrl || null, previewText } };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  await getStore(session.shop);
  const fonts = await prisma.embroideryFont.findMany({ where: { shop: session.shop }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return { fonts: fonts.map((f) => ({ id: f.id, name: f.name, cssFamily: f.cssFamily, stylesheetUrl: f.stylesheetUrl, previewText: f.previewText, enabled: f.enabled })) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");

  if (intent === "create") {
    const { errors, data } = readFont(form);
    if (errors.length) return { errors };
    const syncError = await withLibrarySync(admin, shop, async () =>
      prisma.embroideryFont.create({ data: { shop, ...data, sortOrder: await nextSortOrder("embroideryFont", shop) } }),
    );
    log.info("fonts.created", { shop, name: data.name });
    return { success: `Font “${data.name}” added.`, errors: syncError ? [syncError] : [] };
  }

  if (!id || !(await ownedBy("embroideryFont", shop, id))) return { errors: ["Font not found."] };
  if (intent === "update") {
    const { errors, data } = readFont(form);
    if (errors.length) return { errors };
    const syncError = await withLibrarySync(admin, shop, () =>
      prisma.embroideryFont.update({ where: { id }, data: { ...data, enabled: form.get("enabled") !== null } }),
    );
    return { success: "Font saved.", errors: syncError ? [syncError] : [] };
  }
  const syncError = await withLibrarySync(admin, shop, async () => {
    if (intent === "delete") await prisma.embroideryFont.delete({ where: { id } });
    if (intent === "up" || intent === "down") await moveItem("embroideryFont", shop, id, intent);
  });
  log.info("fonts.changed", { shop, intent, id });
  return { success: "Fonts updated.", errors: syncError ? [syncError] : [] };
}

function FontRow({ font, first, last }: { font: any; first: boolean; last: boolean }) {
  const fetcher = useFetcher<typeof action>();
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="id" value={font.id} />
        <s-stack gap="small">
          <s-stack direction="inline" justifyContent="space-between" alignItems="center">
            <div style={{ fontFamily: font.cssFamily, fontSize: 26, lineHeight: 1.2 }}>{font.previewText}</div>
            <RowActions id={font.id} first={first} last={last} label={font.name} />
          </s-stack>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="small">
            <s-text-field name="name" label="Name" defaultValue={font.name} />
            <s-text-field name="cssFamily" label="CSS font-family" defaultValue={font.cssFamily} />
            <s-text-field name="stylesheetUrl" label="Stylesheet URL (optional)" defaultValue={font.stylesheetUrl || ""} />
            <s-text-field name="previewText" label="Preview text" defaultValue={font.previewText} />
          </s-grid>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-checkbox name="enabled" value="on" label="Enabled" defaultChecked={font.enabled} />
            <s-button type="submit" loading={fetcher.state !== "idle"}>Save</s-button>
            {fetcher.data?.errors?.length ? <s-text tone="critical">{fetcher.data.errors[0]}</s-text> : null}
          </s-stack>
        </s-stack>
      </fetcher.Form>
    </s-box>
  );
}

export default function Fonts() {
  const { fonts } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const stylesheets = [...new Set(fonts.map((f) => f.stylesheetUrl).filter(Boolean))] as string[];
  return (
    <s-page heading="Fonts">
      <s-link slot="breadcrumb-actions" href="/app/library">Design library</s-link>
      {stylesheets.map((href) => <link key={href} rel="stylesheet" href={href} />)}
      <Banners errors={result?.errors} success={result && "success" in result ? result.success : null} />
      <s-section heading="Add a font">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-text-field name="name" label="Name" required placeholder="Handwriting" />
            <s-text-field name="cssFamily" label="CSS font-family" required placeholder="'Dancing Script', cursive" />
            <s-text-field name="stylesheetUrl" label="Stylesheet URL (optional)" placeholder="https://fonts.googleapis.com/css2?family=Dancing+Script" />
            <s-text-field name="previewText" label="Preview text" defaultValue="Dr. Asha" />
          </s-grid>
          <s-box paddingBlockStart="base">
            <s-button type="submit" variant="primary" loading={navigation.state === "submitting"}>Add font</s-button>
          </s-box>
        </Form>
      </s-section>
      <s-section heading={`Font library (${fonts.length})`}>
        <s-stack gap="base">
          {fonts.map((font, i) => <FontRow key={font.id} font={font} first={i === 0} last={i === fonts.length - 1} />)}
        </s-stack>
      </s-section>
    </s-page>
  );
}
