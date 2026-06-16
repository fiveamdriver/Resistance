import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server actions handle multipart file uploads. Raise the body size limit so
  // engineers can upload reasonably large netlists / BOMs / PDFs / Altium docs.
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
