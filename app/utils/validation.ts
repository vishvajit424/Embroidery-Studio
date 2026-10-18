/** Pure validation helpers shared by the admin, the upload endpoint and tests. */

export const CUSTOMER_UPLOAD_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const ICON_UPLOAD_TYPES: Record<string, string> = {
  ...CUSTOMER_UPLOAD_TYPES,
  svg: "image/svg+xml",
};

/** Shopify's storefront file-upload ceiling; also our hard maximum. */
export const MAX_UPLOAD_MB = 20;

export type FileMeta = { name: string; type: string; size: number };

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || "").trim());
  return match ? match[1].toLowerCase() : "";
}

/** Validates name/MIME/size. Returns an error message, or null when valid. */
export function validateFileMeta(
  file: FileMeta,
  maxMb: number,
  allowed: Record<string, string> = CUSTOMER_UPLOAD_TYPES,
): string | null {
  if (!file || !file.name) return "Please choose a file.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "The file is empty.";
  const ext = extensionOf(file.name);
  const expected = allowed[ext];
  const list = Object.keys(allowed).map((e) => e.toUpperCase()).join(", ");
  if (!expected) return `Unsupported file type. Please upload ${list}.`;
  const mime = String(file.type || "").toLowerCase();
  const accepted = mime === expected || (expected === "image/jpeg" && mime === "image/jpg");
  if (!accepted) return `The file content type (${mime || "unknown"}) does not match .${ext}.`;
  const limit = Math.min(MAX_UPLOAD_MB, Math.max(1, Number(maxMb) || 5));
  if (file.size > limit * 1024 * 1024) return `File must be ${limit} MB or smaller.`;
  return null;
}

/** Detects the real image type from the first bytes (magic numbers). */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(bytes.slice(from, to)));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/** SVGs can carry script; merchant icons are rejected if they contain any. */
export function isSafeSvg(text: string): boolean {
  const lower = text.toLowerCase();
  return !/<script|on[a-z]+\s*=|javascript:|<foreignobject|<iframe|<embed|<object/.test(lower);
}

export function isHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "").trim());
}

export function normalizeHex(value: string): string {
  let hex = String(value || "").trim().toUpperCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9A-F]{3}$/.test(hex)) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex;
}

/** Parses a merchant-entered price; returns the fallback when invalid. */
export function parsePrice(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined || String(raw).trim() === "") return fallback;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return fallback;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return fallback;
  return Math.round(value * 100) / 100;
}

export function parseIntInRange(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isShopifyGid(value: unknown, type: string): boolean {
  return typeof value === "string" && new RegExp(`^gid://shopify/${type}/\\d+$`).test(value);
}

/** Letters (any script), numbers, spaces and . , ' & ( ) - / */
export const ALLOWED_TEXT = /^[\p{L}\p{M}\p{N} .,'&()\-/]*$/u;

export function validateEmbroideryText(
  value: string,
  opts: { required: boolean; maxChars: number; label: string },
): string | null {
  const text = String(value || "").trim();
  if (!text) return opts.required ? `${opts.label} is required.` : null;
  if ([...text].length > opts.maxChars) return `${opts.label} must be ${opts.maxChars} characters or fewer.`;
  if (!ALLOWED_TEXT.test(text)) return `${opts.label} can only use letters, numbers, spaces and . , ' & ( ) - /`;
  return null;
}
