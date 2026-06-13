"use client";

import { Dithering } from "@paper-design/shaders-react";

export default function DitheringBackground() {
  return (
    <Dithering
      colorBack="#000a05"
      colorFront="#024d1f"
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
