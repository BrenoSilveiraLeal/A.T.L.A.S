import { ImageResponse } from "next/og";

/** The ATLAS mark for the phone's home screen (the browser tab uses icon.svg, the same drawing). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#5fbf8f" }}>
        <svg width="150" height="150" viewBox="0 0 64 64">
          <path fill="#fff" fillRule="evenodd" d="M13 52 26.6 12h10.8L51 52H40.4l-2.5-8H25.9l-2.5 8Zm15.5-16h6.9L32 25.5Z" />
        </svg>
      </div>
    ),
    size,
  );
}
