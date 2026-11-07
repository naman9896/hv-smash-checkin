import type { MetadataRoute } from "next";
import { business } from "@config/business";

/** "Add to Home Screen" opens straight into the kiosk with no browser bars. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${business.name} Check-in`,
    short_name: "Check-in",
    description: `Customer check-in for ${business.name}`,
    start_url: "/kiosk",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
    background_color: business.colors.dark,
    theme_color: business.colors.dark,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
