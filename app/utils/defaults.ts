/**
 * Default library seeded for every new shop. Merchants can edit, disable or
 * delete all of it from the admin. Icons are original SVG artwork bundled with
 * the theme extension ("asset:" URLs) and mirrored in /public/icons for the admin.
 */

export const OPTION_KEYS = ["bundle", "top", "bottom", "logo"] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const DEFAULT_OPTIONS: Array<{ key: OptionKey; label: string; description: string; sortOrder: number }> = [
  { key: "bundle", label: "Embroidery Bundle", description: "Name + designation, icon/logo and name on bottom", sortOrder: 0 },
  { key: "top", label: "Top Embroidery", description: "Your name and icon/logo stitched on your top.", sortOrder: 1 },
  { key: "bottom", label: "Bottom Embroidery", description: "Your name stitched on your bottom.", sortOrder: 2 },
  { key: "logo", label: "Icon / Logo", description: "Add a classic icon or upload your own logo.", sortOrder: 3 },
];

export const DEFAULT_COLORS: Array<{ name: string; hex: string }> = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Black", hex: "#111111" },
  { name: "Gold", hex: "#C9A227" },
  { name: "Silver", hex: "#B8BCC2" },
  { name: "Grey", hex: "#7A7F87" },
  { name: "Red", hex: "#C62828" },
  { name: "Blue", hex: "#1E4FA8" },
  { name: "Green", hex: "#2E7D4F" },
  { name: "Pink", hex: "#E97BA0" },
];

export const DEFAULT_FONTS: Array<{ name: string; cssFamily: string; previewText: string }> = [
  { name: "Block", cssFamily: "Impact, 'Arial Black', 'Franklin Gothic Heavy', sans-serif", previewText: "DR. ASHA" },
  { name: "Script", cssFamily: "'Brush Script MT', 'Segoe Script', 'Apple Chancery', cursive", previewText: "Dr. Asha" },
  { name: "Classic", cssFamily: "Georgia, 'Times New Roman', serif", previewText: "Dr. Asha" },
  { name: "Modern", cssFamily: "Futura, 'Century Gothic', 'Avenir Next', sans-serif", previewText: "Dr. Asha" },
  { name: "Serif", cssFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, serif", previewText: "Dr. Asha" },
  { name: "Sans Serif", cssFamily: "'Helvetica Neue', Arial, sans-serif", previewText: "Dr. Asha" },
];

export const DEFAULT_ICONS: Array<{ name: string; file: string; placement: "top" | "bottom" | "any" }> = [
  { name: "Caduceus", file: "icon-caduceus.svg", placement: "top" },
  { name: "Heart", file: "icon-heart.svg", placement: "top" },
  { name: "Stethoscope", file: "icon-stethoscope.svg", placement: "top" },
  { name: "Red Cross", file: "icon-cross.svg", placement: "top" },
  { name: "Star of Life", file: "icon-star-of-life.svg", placement: "top" },
  { name: "Tooth", file: "icon-tooth.svg", placement: "top" },
  { name: "Syringe", file: "icon-syringe.svg", placement: "top" },
  { name: "Medical Bag", file: "icon-medical-bag.svg", placement: "top" },
  { name: "Hospital", file: "icon-hospital.svg", placement: "top" },
];

export type PositionSeed = { key: string; name: string; area: "top" | "bottom"; x: number; y: number; width: number; rotation: number };

/** x/y are the centre of the embroidery, width is its width - all as a
 * fraction (0..1) of the preview image. "Left chest" is the wearer's left,
 * which is on the viewer's right of a front-facing product photo. */
export const DEFAULT_POSITIONS: PositionSeed[] = [
  { key: "leftChest", name: "Left Chest", area: "top", x: 0.64, y: 0.33, width: 0.2, rotation: 0 },
  { key: "rightChest", name: "Right Chest", area: "top", x: 0.36, y: 0.33, width: 0.09, rotation: 0 },
  { key: "centerChest", name: "Center Chest", area: "top", x: 0.5, y: 0.34, width: 0.24, rotation: 0 },
  { key: "leftSleeve", name: "Left Sleeve", area: "top", x: 0.84, y: 0.36, width: 0.1, rotation: -8 },
  { key: "rightSleeve", name: "Right Sleeve", area: "top", x: 0.16, y: 0.36, width: 0.1, rotation: 8 },
  { key: "topCustom", name: "Custom (top)", area: "top", x: 0.5, y: 0.5, width: 0.2, rotation: 0 },
  { key: "leftSide", name: "Left Side", area: "bottom", x: 0.64, y: 0.32, width: 0.2, rotation: 0 },
  { key: "rightSide", name: "Right Side", area: "bottom", x: 0.36, y: 0.32, width: 0.2, rotation: 0 },
  { key: "back", name: "Back", area: "bottom", x: 0.5, y: 0.2, width: 0.28, rotation: 0 },
  { key: "bottomCustom", name: "Custom (bottom)", area: "bottom", x: 0.5, y: 0.5, width: 0.2, rotation: 0 },
];

export const DEFAULT_PRICES = { top: 299, bottom: 199, logo: 250, bundle: 598, bundleCompareAt: 748 };

export const CONFIG_VERSION = 3;
