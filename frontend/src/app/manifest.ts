import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FINN · what matters in your portfolio",
    short_name: "FINN",
    description: "Push digest of what changed in your portfolio, and research grounded in primary documents.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0c0f",
    theme_color: "#0a0c0f",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
