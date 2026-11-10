import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0c0f",
          color: "#e8eaed",
          fontSize: 300,
          fontWeight: 900,
          letterSpacing: -12,
        }}
      >
        F
      </div>
    ),
    size,
  );
}
