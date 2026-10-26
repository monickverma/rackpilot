import { ImageResponse } from "next/og";

// The preview card shown when a RackPilot link is shared, e.g. on WhatsApp.
export const alt = "RackPilot: WhatsApp orders in, reserved stock and pick lists out";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 80, background: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 14, background: "#27272a" }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round">
              <path d="M4 20V5M20 20V5M4 9h16M4 15h16" />
              <path d="M8 12.5h3" strokeWidth="2.4" />
            </svg>
          </div>
          <div style={{ fontSize: 38, color: "#18181b" }}>RackPilot</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 66, letterSpacing: -2, lineHeight: 1.1 }}>
          <div style={{ color: "#18181b" }}>WhatsApp orders in.</div>
          <div style={{ color: "#71717a" }}>Reserved stock and pick lists out.</div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#52525b" }}>Hinglish orders · stock held by size, colour and rack · live demo</div>
      </div>
    ),
    size,
  );
}
