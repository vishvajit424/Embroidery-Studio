import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { withLibrarySync } from "../services/library.server";
import { moveItem, nextSortOrder, ownedBy } from "../services/library-crud.server";
import { uploadImageToShopifyFiles } from "../services/files.server";
import { log } from "../services/logger.server";
import { Banners } from "../components/Banners";
import { RowActions } from "../components/RowActions";
import { adminAssetUrl } from "../utils/format";
import { ICON_UPLOAD_TYPES, extensionOf, isHttpsUrl, isSafeSvg, sniffImageType, validateFileMeta } from "../utils/validation";

const PLACEMENTS = ["top", "bottom", "any"];
const ICON_MAX_MB = 2;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  await getStore(session.shop);
  const icons = await prisma.embroideryIcon.findMany({ where: { shop: session.shop }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return { icons: icons.map((i) => ({ id: i.id, name: i.name, imageUrl: i.imageUrl, placement: i.placement, enabled: i.enabled })) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");

  if (intent === "create") {
    const name = String(form.get("name") || "").trim().slice(0, 60);
    const placement = PLACEMENTS.includes(String(form.get("placement"))) ? String(form.get("placement")) : "top";
    const file = form.get("file");
    let imageUrl = String(form.get("imageUrl") || "").trim();
    let fileId: string | null = null;
    if (!name) return { errors: ["Please enter an icon name."] };

    if (file instanceof File && file.size > 0) {
      const metaError = validateFileMeta({ name: file.name, type: file.type, size: file.size }, ICON_MAX_MB, ICON_UPLOAD_TYPES);
      if (metaError) return { errors: [metaError] };
      const bytes = new Uint8Array(await file.arrayBuffer());
      const expected = ICON_UPLOAD_TYPES[extensionOf(file.name)];
      if (sniffImageType(bytes) !== expected) return { errors: ["The file is not a valid SVG, PNG, JPG or WebP image."] };
      if (expected === "image/svg+xml" && !isSafeSvg(new TextDecoder().decode(bytes))) {
        return { errors: ["This SVG contains scripts or embedded content and cannot be used."] };
      }
      try {
        const uploaded = await uploadImageToShopifyFiles(admin, { bytes, filename: file.name, mimeType: expected, alt: `Embroidery icon: ${name}` });
        if (!uploaded.url) return { errors: ["Shopify is still processing the image. Please try again in a moment."] };
        imageUrl = uploaded.url;
        fileId = uploaded.fileId;
      } catch (error) {
        log.error("icons.upload_failed", { shop, error });
        return { errors: ["The image could not be uploaded to Shopify Files."] };
      }
    } else if (!isHttpsUrl(imageUrl)) {
      return { errors: ["Upload an image, or enter an https:// image URL."] };
    }

    const syncError = await withLibrarySync(admin, shop, async () =>
      prisma.embroideryIcon.create({ data: { shop, name, imageUrl, fileId, placement, sortOrder: await nextSortOrder("embroideryIcon", shop) } }),
    );
    log.info("icons.created", { shop, name });
    return { success: `Icon “${name}” added.`, errors: syncError ? [syncError] : [] };
  }

  if (!id || !(await ownedBy("embroideryIcon", shop, id))) return { errors: ["Icon not found."] };

  const syncError = await withLibrarySync(admin, shop, async () => {
    if (intent === "update") {
      await prisma.embroideryIcon.update({
        where: { id },
        data: {
          name: String(form.get("name") || "").trim().slice(0, 60) || "Icon",
          placement: PLACEMENTS.includes(String(form.get("placement"))) ? String(form.get("placement")) : "top",
          enabled: form.get("enabled") !== null,
        },
      });
    } else if (intent === "delete") {
      await prisma.embroideryIcon.delete({ where: { id } });
    } else if (intent === "up" || intent === "down") {
      await moveItem("embroideryIcon", shop, id, intent);
    }
  });
  log.info("icons.changed", { shop, intent, id });
  return { success: "Icons updated.", errors: syncError ? [syncError] : [] };
}

function IconRow({ icon, first, last }: { icon: any; first: boolean; last: boolean }) {
  const fetcher = useFetcher();
  return (
    <s-table-row>
      <s-table-cell>
        <img src={adminAssetUrl(icon.imageUrl)} alt="" width={40} height={40} style={{ objectFit: "contain", background: "#f4f4f5", borderRadius: 6, padding: 4 }} />
      </s-table-cell>
      <s-table-cell>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="id" value={icon.id} />
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text-field name="name" label="Name" labelAccessibilityVisibility="exclusive" defaultValue={icon.name} />
            <s-select name="placement" label="Placement" labelAccessibilityVisibility="exclusive" value={icon.placement}>
              <s-option value="top">Top</s-option>
              <s-option value="bottom">Bottom</s-option>
              <s-option value="any">Any</s-option>
            </s-select>
            <s-checkbox name="enabled" value="on" label="Enabled" defaultChecked={icon.enabled} />
            <s-button type="submit" loading={fetcher.state !== "idle"}>Save</s-button>
          </s-stack>
        </fetcher.Form>
      </s-table-cell>
      <s-table-cell><RowActions id={icon.id} first={first} last={last} label={icon.name} /></s-table-cell>
    </s-table-row>
  );
}

export default function Icons() {
  const { icons } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <s-page heading="Icons">
      <s-link slot="breadcrumb-actions" href="/app/library">Design library</s-link>
      <Banners errors={result?.errors} success={result && "success" in result ? result.success : null} />
      <s-section heading="Add an icon">
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="create" />
          <s-stack gap="base">
            <s-text-field name="name" label="Name" required placeholder="e.g. Paw print" />
            <s-select name="placement" label="Placement" value="top">
              <s-option value="top">Top</s-option>
              <s-option value="bottom">Bottom</s-option>
              <s-option value="any">Any</s-option>
            </s-select>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Image file (SVG, PNG, JPG or WebP, max {ICON_MAX_MB} MB)</span>
              <input type="file" name="file" accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp" />
            </label>
            <s-text-field name="imageUrl" label="…or image URL" placeholder="https://cdn.shopify.com/..." details="Single-colour icons with a transparent background work best: they are recoloured with the chosen thread colour." />
            <s-button type="submit" variant="primary" loading={navigation.state === "submitting"}>Add icon</s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading={`Icon library (${icons.length})`} padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header>Icon</s-table-header>
            <s-table-header>Details</s-table-header>
            <s-table-header>Order</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {icons.map((icon, i) => <IconRow key={icon.id} icon={icon} first={i === 0} last={i === icons.length - 1} />)}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
