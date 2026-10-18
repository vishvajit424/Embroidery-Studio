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
import { isHexColor, normalizeHex } from "../utils/validation";

function readColor(form: FormData) {
  const name = String(form.get("name") || "").trim().slice(0, 40);
  const hex = String(form.get("hex") || "").trim();
  const errors: string[] = [];
  if (!name) errors.push("Colour name is required.");
  if (!isHexColor(hex)) errors.push("Enter a hex colour like #C9A227.");
  return { errors, data: { name, hex: isHexColor(hex) ? normalizeHex(hex) : hex } };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  await getStore(session.shop);
  const colors = await prisma.embroideryColor.findMany({ where: { shop: session.shop }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return { colors: colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex, enabled: c.enabled })) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");

  if (intent === "create") {
    const { errors, data } = readColor(form);
    if (errors.length) return { errors };
    const syncError = await withLibrarySync(admin, shop, async () =>
      prisma.embroideryColor.create({ data: { shop, ...data, sortOrder: await nextSortOrder("embroideryColor", shop) } }),
    );
    log.info("colors.created", { shop, name: data.name });
    return { success: `Colour “${data.name}” added.`, errors: syncError ? [syncError] : [] };
  }
  if (!id || !(await ownedBy("embroideryColor", shop, id))) return { errors: ["Colour not found."] };
  if (intent === "update") {
    const { errors, data } = readColor(form);
    if (errors.length) return { errors };
    const syncError = await withLibrarySync(admin, shop, () =>
      prisma.embroideryColor.update({ where: { id }, data: { ...data, enabled: form.get("enabled") !== null } }),
    );
    return { success: "Colour saved.", errors: syncError ? [syncError] : [] };
  }
  const syncError = await withLibrarySync(admin, shop, async () => {
    if (intent === "delete") await prisma.embroideryColor.delete({ where: { id } });
    if (intent === "up" || intent === "down") await moveItem("embroideryColor", shop, id, intent);
  });
  log.info("colors.changed", { shop, intent, id });
  return { success: "Colours updated.", errors: syncError ? [syncError] : [] };
}

function ColorRow({ color, first, last }: { color: any; first: boolean; last: boolean }) {
  const fetcher = useFetcher<typeof action>();
  return (
    <s-table-row>
      <s-table-cell>
        <span aria-hidden="true" style={{ display: "inline-block", width: 28, height: 28, borderRadius: "50%", background: color.hex, border: "1px solid #c9cccf" }} />
      </s-table-cell>
      <s-table-cell>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="id" value={color.id} />
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text-field name="name" label="Name" labelAccessibilityVisibility="exclusive" defaultValue={color.name} />
            <input type="color" name="hex" defaultValue={color.hex.length === 7 ? color.hex : "#000000"} aria-label={`${color.name} colour`} style={{ width: 44, height: 32, border: 0, background: "none" }} />
            <s-checkbox name="enabled" value="on" label="Enabled" defaultChecked={color.enabled} />
            <s-button type="submit" loading={fetcher.state !== "idle"}>Save</s-button>
            {fetcher.data?.errors?.length ? <s-text tone="critical">{fetcher.data.errors[0]}</s-text> : null}
          </s-stack>
        </fetcher.Form>
      </s-table-cell>
      <s-table-cell>{color.hex}</s-table-cell>
      <s-table-cell><RowActions id={color.id} first={first} last={last} label={color.name} /></s-table-cell>
    </s-table-row>
  );
}

export default function Colors() {
  const { colors } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <s-page heading="Thread colours">
      <s-link slot="breadcrumb-actions" href="/app/library">Design library</s-link>
      <Banners errors={result?.errors} success={result && "success" in result ? result.success : null} />
      <s-section heading="Add a colour">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field name="name" label="Name" required placeholder="Navy" />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span>Colour</span>
              <input type="color" name="hex" defaultValue="#1E3A8A" style={{ width: 56, height: 34, border: 0, background: "none" }} />
            </label>
            <s-button type="submit" variant="primary" loading={navigation.state === "submitting"}>Add colour</s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading={`Colour library (${colors.length})`} padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header>Swatch</s-table-header>
            <s-table-header>Details</s-table-header>
            <s-table-header>Hex</s-table-header>
            <s-table-header>Order</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {colors.map((c, i) => <ColorRow key={c.id} color={c} first={i === 0} last={i === colors.length - 1} />)}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
