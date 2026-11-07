import type { MetadataRoute } from "next";

/** "Add to Home Screen" opens straight into the kiosk with no browser bars. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sai Motor Works Check-in",
    short_name: "Check-in",
    description: "Customer check-in for Sai Motor Works",
    start_url: "/kiosk",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
    background_color: "#0F172A",
    theme_color: "#0F172A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
