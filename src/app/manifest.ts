import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: `${BRAND.name} is a multi-store operations platform for retail administration.`,
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f766e",
    icons: [
      {
        src: "/images/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
