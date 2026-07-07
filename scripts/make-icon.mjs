/**
 * Generates electron/assets/icon.png (1024px) from an inline SVG — a resistor
 * zigzag in the app's palette. Run `node scripts/make-icon.mjs` after changing
 * the artwork; the PNG is committed so builds don't depend on this script.
 * Phase 3 packaging derives .icns/.ico from the same PNG.
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101014"/>
      <stop offset="1" stop-color="#050506"/>
    </linearGradient>
  </defs>
  <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#bg)"
        stroke="rgba(255,255,255,0.14)" stroke-width="8"/>
  <path d="M144 512 H304 L352 384 L448 640 L544 384 L640 640 L688 512 H880"
        fill="none" stroke="#2dd4bf" stroke-width="58"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="144" cy="512" r="34" fill="#F5F0E8"/>
  <circle cx="880" cy="512" r="34" fill="#F5F0E8"/>
</svg>`;

const outDir = path.join(root, "electron", "assets");
mkdirSync(outDir, { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(path.join(outDir, "icon.png"), png);
console.log(`wrote ${path.join(outDir, "icon.png")} (${png.length} bytes)`);
