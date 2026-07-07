import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) that the Electron shell
  // can spawn directly. Has no effect on `next dev`.
  output: "standalone",
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
  // The in-build lint/type-check phase deadlocks under Node 26 (0% CPU, never
  // returns). Skip it here — correctness is still gated by `npm run typecheck`
  // and `npm run lint`, which run type-checking outside the Next build worker.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
