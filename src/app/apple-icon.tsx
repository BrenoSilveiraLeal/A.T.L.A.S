import { ImageResponse } from "next/og";

/** The ATLAS mark for the phone's home screen (the browser tab uses icon.svg, the same drawing). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #72d3a2, #46a877)" }}>
        <svg width="150" height="150" viewBox="0 0 64 64">
          <path fill="#fff" fillRule="evenodd" d="M27 12h10l13.5 39h-9.3l-2.7-8.2H25.5L22.8 51h-9.3zM28.4 35h7.2L32 24.2z" />
        </svg>
      </div>
    ),
    size,
  );
}
