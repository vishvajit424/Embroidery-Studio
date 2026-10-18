import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export type VariantSummary = { id: string; title: string; productTitle: string; price?: string; image?: string } | null;

type Props = {
  name: string;
  label: string;
  initial: VariantSummary;
  /** Shown when nothing is selected, e.g. the shop-wide default. */
  fallbackText?: string;
  missing?: boolean;
};

/**
 * Lets the merchant pick an add-on variant with Shopify's resource picker and
 * shows the actual product/variant that is selected. The chosen id is posted
 * with the surrounding form through a hidden input.
 */
export function VariantPicker({ name, label, initial, fallbackText, missing }: Props) {
  const shopify = useAppBridge();
  const [selected, setSelected] = useState<VariantSummary>(initial);
  const [isMissing, setMissing] = useState(Boolean(missing));

  async function pick() {
    const result: any = await shopify.resourcePicker({ type: "variant", multiple: false, filter: { query: "tag:embroidery-addon" } });
    const variant = result?.[0];
    if (!variant) return;
    setSelected({
      id: variant.id,
      title: variant.title,
      productTitle: variant.product?.title || variant.displayName || "",
      price: variant.price,
      image: variant.image?.originalSrc || variant.product?.images?.[0]?.originalSrc,
    });
    setMissing(false);
  }

  return (
    <s-box padding="small-200" border="base" borderRadius="base">
      <input type="hidden" name={name} value={selected?.id || ""} />
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
        <s-stack gap="small-200">
          <s-text type="strong">{label}</s-text>
          {selected ? (
            <s-text>
              {selected.productTitle}
              {selected.title && selected.title !== "Default Title" ? ` — ${selected.title}` : ""}
            </s-text>
          ) : (
            <s-text color="subdued">{fallbackText || "Not mapped"}</s-text>
          )}
          {isMissing ? <s-badge tone="critical">Variant not found in Shopify</s-badge> : null}
        </s-stack>
        <s-stack direction="inline" gap="small">
          <s-button onClick={pick}>{selected ? "Change" : "Select variant"}</s-button>
          {selected ? <s-button variant="tertiary" onClick={() => setSelected(null)}>Clear</s-button> : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}
