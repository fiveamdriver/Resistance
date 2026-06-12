import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server actions handle multipart file uploads. Raise the body size limit so
  // engineers can upload reasonably large netlists / BOMs / PDFs.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
