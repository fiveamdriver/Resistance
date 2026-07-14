import type { Config } from "tailwindcss";

const config: Config = {
  // Theme is a manually-toggled data-theme attribute (see theme-provider.tsx),
  // not the OS preference — match dark: variants to that instead of the
  // default prefers-color-scheme media query.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#1a3a5c",
          dark: "#142d47",
        },
      },
    },
  },
  plugins: [],
};

export default config;
