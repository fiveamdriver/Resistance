"use client";

import { Dithering } from "@paper-design/shaders-react";

import { useTheme } from "@/components/theme-provider";

/**
 * Dark mode only: ambient shader motion reads as a "technical tool" texture
 * at 11% opacity, but the same trick on a light/cream background is much
 * more perceptually salient and competes with scanning dense BOM/net
 * tables — professional light-mode tools (Figma, spreadsheets, KiCad's
 * light theme) are flat for exactly that reason.
 */
export default function DitheringBackground() {
  const { theme } = useTheme();
  if (theme !== "dark") return null;

  return (
    <Dithering
      colorBack="#000a05"
      colorFront="#19375e"
      shape="warp"
      type="4x4"
      speed={0.2}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0.11,
      }}
    />
  );
}
