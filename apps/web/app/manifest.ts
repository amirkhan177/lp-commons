import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LP Commons",
    short_name: "LP Commons",
    description: "Warm intro routes to venture funds and LPs, from public filings and your own network.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#6d5dfc",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
