import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse and pdfjs-dist use ESM patterns incompatible with Next.js RSC
  // webpack bundling — exclude them so Next.js requires them natively at runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Server actions handle multipart file uploads. Raise the body size limit so
  // engineers can upload reasonably large netlists / BOMs / PDFs / Altium docs.
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
