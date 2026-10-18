/**
 * Builds the JSON documents the storefront and the Cart Transform read:
 *  - product metafield  $app:embroidery / config   (per product)
 *  - app metafield       embroidery / library       (per shop)
 * Pure functions: plain objects in, plain objects out.
 */
import { CONFIG_VERSION, DEFAULT_POSITIONS } from "./defaults.ts";

export type PositionValue = { x: number; y: number; width: number; rotation: number };

export type ProductConfigInput = {
  enabled: boolean;
  topEnabled: boolean;
  bottomEnabled: boolean;
  logoEnabled: boolean;
  bundleEnabled: boolean;
  topPrice: number;
  bottomPrice: number;
  logoPrice: number;
  bundlePrice: number;
  bundleCompareAt: number;
  topPosition: string;
  iconPosition: string;
  bottomPosition: string;
  positionOverrides: string | Record<string, PositionValue>;
  bottomImageUrl?: string | null;
  uploadMaxSize: number;
  requireName: boolean;
  maxChars: number;
  topVariantId?: string | null;
  bottomVariantId?: string | null;
  logoVariantId?: string | null;
  bundleVariantId?: string | null;
};

export type StoreDefaults = {
  topVariantId?: string | null;
  bottomVariantId?: string | null;
  logoVariantId?: string | null;
  bundleVariantId?: string | null;
};

export function parseOverrides(raw: unknown): Record<string, PositionValue> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, PositionValue> = {};
  for (const [key, v] of Object.entries(value as Record<string, any>)) {
    if (!v || typeof v !== "object") continue;
    const x = Number(v.x), y = Number(v.y), width = Number(v.width), rotation = Number(v.rotation || 0);
    if ([x, y, width, rotation].every(Number.isFinite)) {
      out[key] = {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        width: Math.min(1, Math.max(0.01, width)),
        rotation: Math.min(180, Math.max(-180, rotation)),
      };
    }
  }
  return out;
}

export function resolveAddons(product: ProductConfigInput, store: StoreDefaults) {
  return {
    top: product.topVariantId || store.topVariantId || "",
    bottom: product.bottomVariantId || store.bottomVariantId || "",
    logo: product.logoVariantId || store.logoVariantId || "",
    bundle: product.bundleVariantId || store.bundleVariantId || "",
  };
}

/** Problems that would make an enabled option uncollectable. */
export function configProblems(product: ProductConfigInput, store: StoreDefaults): string[] {
  const addons = resolveAddons(product, store);
  const problems: string[] = [];
  if (product.topEnabled && !addons.top) problems.push("Top embroidery is on but no Top add-on variant is mapped.");
  if (product.bottomEnabled && !addons.bottom) problems.push("Bottom embroidery is on but no Bottom add-on variant is mapped.");
  if (product.logoEnabled && !addons.logo) problems.push("Icon/Logo is on but no Logo add-on variant is mapped.");
  if (product.bundleEnabled && !addons.bundle) problems.push("Bundle is on but no Bundle add-on variant is mapped.");
  if (product.bundleEnabled && (!product.topEnabled || !product.bottomEnabled)) {
    problems.push("The bundle needs both Top and Bottom embroidery enabled.");
  }
  if (product.enabled && !product.topEnabled && !product.bottomEnabled && !product.bundleEnabled) {
    problems.push("Enable at least one of Top, Bottom or Bundle.");
  }
  return problems;
}

export function buildProductMetafield(product: ProductConfigInput, store: StoreDefaults) {
  const addons = resolveAddons(product, store);
  const round = (n: number) => Math.round(Number(n || 0) * 100) / 100;
  return {
    v: CONFIG_VERSION,
    enabled: Boolean(product.enabled),
    requireName: Boolean(product.requireName),
    maxChars: product.maxChars,
    uploadMaxMb: product.uploadMaxSize,
    options: {
      top: { enabled: Boolean(product.topEnabled && addons.top), price: round(product.topPrice) },
      bottom: { enabled: Boolean(product.bottomEnabled && addons.bottom), price: round(product.bottomPrice) },
      logo: { enabled: Boolean(product.logoEnabled && addons.logo), price: round(product.logoPrice) },
      bundle: {
        enabled: Boolean(product.bundleEnabled && addons.bundle && product.topEnabled && product.bottomEnabled),
        price: round(product.bundlePrice),
        compareAt: round(product.bundleCompareAt),
      },
    },
    positions: { top: product.topPosition, icon: product.iconPosition, bottom: product.bottomPosition },
    positionOverrides: parseOverrides(product.positionOverrides),
    bottomImage: product.bottomImageUrl || "",
    addons,
  };
}

export type LibraryInput = {
  options: Array<{ key: string; label: string; description: string; enabled: boolean }>;
  colors: Array<{ id: string; name: string; hex: string; enabled: boolean; sortOrder: number }>;
  fonts: Array<{ id: string; name: string; cssFamily: string; stylesheetUrl?: string | null; enabled: boolean; sortOrder: number }>;
  icons: Array<{ id: string; name: string; imageUrl: string; placement: string; enabled: boolean; sortOrder: number }>;
  positions: Array<{ key: string; name: string; area: string; x: number; y: number; width: number; rotation: number; enabled: boolean }>;
  uploadMaxMb: number;
};

const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

export function buildLibrary(input: LibraryInput) {
  const positions: Record<string, PositionValue & { name: string; area: string }> = {};
  for (const seed of DEFAULT_POSITIONS) {
    positions[seed.key] = { name: seed.name, area: seed.area, x: seed.x, y: seed.y, width: seed.width, rotation: seed.rotation };
  }
  for (const p of input.positions) {
    if (!p.enabled) continue;
    positions[p.key] = { name: p.name, area: p.area, x: p.x, y: p.y, width: p.width, rotation: p.rotation };
  }
  const options: Record<string, { label: string; description: string }> = {};
  for (const o of input.options) {
    if (o.enabled) options[o.key] = { label: o.label, description: o.description };
  }
  return {
    v: CONFIG_VERSION,
    options,
    colors: input.colors.filter((c) => c.enabled).sort(bySort).map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
    fonts: input.fonts
      .filter((f) => f.enabled)
      .sort(bySort)
      .map((f) => ({ id: f.id, name: f.name, family: f.cssFamily, stylesheet: f.stylesheetUrl || "" })),
    icons: input.icons
      .filter((i) => i.enabled)
      .sort(bySort)
      .map((i) => ({ id: i.id, name: i.name, image: i.imageUrl, placement: i.placement })),
    positions,
    uploadMaxMb: input.uploadMaxMb,
  };
}
