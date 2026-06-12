import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Lightweight brand palette for the engineering-tool look & feel.
        brand: {
          DEFAULT: "#2563eb",
          dark: "#1e40af",
        },
      },
    },
  },
  plugins: [],
};

export default config;
