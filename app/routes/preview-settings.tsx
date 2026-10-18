import { useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { withLibrarySync } from "../services/library.server";
import { log } from "../services/logger.server";
import { Banners } from "../components/Banners";
import { PositionPreview } from "../components/PositionPreview";
import { clamp } from "../utils/validation";

function readPosition(form: FormData) {
  return {
    name: String(form.get("name") || "").trim().slice(0, 40) || "Position",
    area: form.get("area") === "bottom" ? "bottom" : "top",
    x: clamp(form.get("x"), 0, 1, 0.5),
    y: clamp(form.get("y"), 0, 1, 0.5),
    width: clamp(form.get("width"), 0.01, 1, 0.2),
    rotation: clamp(form.get("rotation"), -180, 180, 0),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  await getStore(session.shop);
  const positions = await prisma.embroideryPosition.findMany({ where: { shop: session.shop }, orderBy: [{ area: "desc" }, { name: "asc" }] });
  const inUse = await prisma.productEmbroideryConfig.findMany({ where: { shop: session.shop }, select: { topPosition: true, iconPosition: true, bottomPosition: true } });
  const used = new Set(inUse.flatMap((c) => [c.topPosition, c.iconPosition, c.bottomPosition]));
  return { positions: positions.map((p) => ({ id: p.id, key: p.key, name: p.name, area: p.area, x: p.x, y: p.y, width: p.width, rotation: p.rotation, enabled: p.enabled, used: used.has(p.key) })) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");

  if (intent === "create") {
    const data = readPosition(form);
    const key = `custom${Date.now().toString(36)}`;
    const syncError = await withLibrarySync(admin, shop, () => prisma.embroideryPosition.create({ data: { shop, key, ...data } }));
    log.info("positions.created", { shop, key });
    return { success: `Position “${data.name}” added.`, errors: syncError ? [syncError] : [] };
  }
  const existing = await prisma.embroideryPosition.findFirst({ where: { id, shop } });
  if (!existing) return { errors: ["Position not found."] };
  if (intent === "delete") {
    const used = await prisma.productEmbroideryConfig.count({
      where: { shop, OR: [{ topPosition: existing.key }, { iconPosition: existing.key }, { bottomPosition: existing.key }] },
    });
    if (used) return { errors: [`“${existing.name}” is used by ${used} product(s). Change those products first, or disable it instead.`] };
  }
  const syncError = await withLibrarySync(admin, shop, async () => {
    if (intent === "update") await prisma.embroideryPosition.update({ where: { id }, data: { ...readPosition(form), enabled: form.get("enabled") !== null } });
    if (intent === "delete") await prisma.embroideryPosition.delete({ where: { id } });
  });
  log.info("positions.changed", { shop, intent, key: existing.key });
  return { success: "Positions updated.", errors: syncError ? [syncError] : [] };
}

function PositionRow({ position, onPreview }: { position: any; onPreview: (p: any) => void }) {
  const fetcher = useFetcher<typeof action>();
  const [draft, setDraft] = useState(position);
  const set = (field: string, value: string) => {
    const next = { ...draft, [field]: field === "name" ? value : Number(value) };
    setDraft(next);
    onPreview(next);
  };
  return (
    <s-box padding="small" border="base" borderRadius="base">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="id" value={position.id} />
        <input type="hidden" name="area" value={position.area} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,2fr) repeat(4, minmax(70px,1fr))", gap: 8, alignItems: "end" }} onFocus={() => onPreview(draft)}>
          <label className="es-admin-field"><span>Name</span><input name="name" value={draft.name} onChange={(e) => set("name", e.target.value)} /></label>
          {(["x", "y", "width", "rotation"] as const).map((f) => (
            <label key={f} className="es-admin-field">
              <span>{f === "rotation" ? "Rotate °" : f}</span>
              <input name={f} type="number" step={f === "rotation" ? 1 : 0.01} min={f === "rotation" ? -180 : 0} max={f === "rotation" ? 180 : 1} value={draft[f]} onChange={(e) => set(f, e.target.value)} />
            </label>
          ))}
        </div>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-checkbox name="enabled" value="on" label="Enabled" defaultChecked={position.enabled} />
          {position.used ? <s-badge tone="info">In use</s-badge> : null}
          <s-button type="submit" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "update"}>Save</s-button>
          <s-button variant="tertiary" tone="critical" onClick={() => {
            if (window.confirm(`Delete ${position.name}?`)) fetcher.submit({ intent: "delete", id: position.id }, { method: "post" });
          }}>Delete</s-button>
          {fetcher.data?.errors?.length ? <s-text tone="critical">{fetcher.data.errors[0]}</s-text> : null}
        </s-stack>
      </fetcher.Form>
    </s-box>
  );
}

export default function PreviewSettings() {
  const { positions } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const [preview, setPreview] = useState<any>(positions[0] || null);

  return (
    <s-page heading="Preview settings">
      <style>{`.es-admin-field{display:flex;flex-direction:column;gap:4px;font-size:12px}.es-admin-field input,.es-admin-field select{padding:6px 8px;border:1px solid #c9cccf;border-radius:8px;font:inherit;min-width:0}`}</style>
      <Banners errors={result?.errors} success={result && "success" in result ? result.success : null} />
      <s-section heading="Placement library">
        <s-paragraph>
          Placements use relative coordinates: <s-text type="strong">x</s-text> and <s-text type="strong">y</s-text> are the centre of the embroidery and
          <s-text type="strong"> width</s-text> its width, each as a fraction (0–1) of the product image. Products pick placements on their configuration page and can fine-tune them there.
        </s-paragraph>
        <s-grid gridTemplateColumns="minmax(0, 2fr) minmax(220px, 1fr)" gap="large">
          <s-stack gap="small">
            {["top", "bottom"].map((area) => (
              <s-stack key={area} gap="small">
                <s-heading>{area === "top" ? "Top placements" : "Bottom placements"}</s-heading>
                {positions.filter((p) => p.area === area).map((p) => <PositionRow key={p.id} position={p} onPreview={setPreview} />)}
              </s-stack>
            ))}
          </s-stack>
          <s-stack gap="small">
            <s-text type="strong">Preview: {preview?.name || "—"}</s-text>
            {preview ? <PositionPreview boxes={[{ key: "p", label: preview.name, x: preview.x, y: preview.y, width: preview.width, rotation: preview.rotation }]} /> : null}
          </s-stack>
        </s-grid>
      </s-section>
      <s-section heading="Add a custom placement">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, alignItems: "end" }}>
            <label className="es-admin-field"><span>Name</span><input name="name" required placeholder="Pocket" /></label>
            <label className="es-admin-field"><span>Area</span><select name="area" defaultValue="top"><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
            <label className="es-admin-field"><span>x</span><input name="x" type="number" step="0.01" min="0" max="1" defaultValue="0.5" /></label>
            <label className="es-admin-field"><span>y</span><input name="y" type="number" step="0.01" min="0" max="1" defaultValue="0.5" /></label>
            <label className="es-admin-field"><span>width</span><input name="width" type="number" step="0.01" min="0.01" max="1" defaultValue="0.2" /></label>
            <label className="es-admin-field"><span>Rotate °</span><input name="rotation" type="number" step="1" min="-180" max="180" defaultValue="0" /></label>
          </div>
          <s-box paddingBlockStart="base"><s-button type="submit" variant="primary" loading={navigation.state === "submitting"}>Add placement</s-button></s-box>
        </Form>
      </s-section>
    </s-page>
  );
}
