export function formatMoney(amount: number, currency = "INR", locale?: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

/** Default icons are stored as "asset:<file>" (served by the theme extension
 * on the storefront, and from /public/icons inside the admin). */
export function adminAssetUrl(url: string) {
  return url.startsWith("asset:") ? `/icons/${url.slice(6)}` : url;
}

export function numericId(gid: string) {
  return String(gid || "").split("/").pop() || "";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
