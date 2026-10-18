type Box = { key: string; label: string; x: number; y: number; width: number; rotation: number; color?: string };

/** Shows placements as boxes on a product image, using the same relative
 * coordinates (0..1) as the storefront preview. */
export function PositionPreview({ imageUrl, boxes, height = 320 }: { imageUrl?: string | null; boxes: Box[]; height?: number }) {
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: height, aspectRatio: "1 / 1", background: "#f4f4f5", borderRadius: 8, overflow: "hidden" }}>
      {imageUrl ? (
        <img src={imageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
      ) : (
        <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <path d="M30 12 L42 8 Q50 14 58 8 L70 12 L88 28 L78 38 L70 32 L70 92 L30 92 L30 32 L22 38 L12 28 Z" fill="#e4e4e7" stroke="#a1a1aa" strokeWidth="0.8" />
        </svg>
      )}
      {boxes.map((b) => (
        <div
          key={b.key}
          title={b.label}
          style={{
            position: "absolute",
            left: `${b.x * 100}%`,
            top: `${b.y * 100}%`,
            width: `${b.width * 100}%`,
            aspectRatio: "3 / 1",
            transform: `translate(-50%, -50%) rotate(${b.rotation}deg)`,
            border: `2px dashed ${b.color || "#6d28d9"}`,
            background: "rgba(109, 40, 217, 0.12)",
            borderRadius: 4,
            fontSize: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#3b0764",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {b.label}
        </div>
      ))}
    </div>
  );
}
