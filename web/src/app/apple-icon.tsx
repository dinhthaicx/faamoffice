import { ImageResponse } from "next/og";
import { logoDataUri } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS fills transparency with black, so the touch icon gets a white tile.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        <img src={logoDataUri()} width={140} height={140} alt="" />
      </div>
    ),
    size,
  );
}
