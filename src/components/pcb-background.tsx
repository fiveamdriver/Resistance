"use client";

import { useEffect, useRef } from "react";

import { useTheme } from "@/components/theme-provider";

interface Pulse {
  pathIndex: number;
  progress: number;
  speed: number;
}

const WIRES: [number, number, number, number][] = [
  [0, 60, 1440, 60],
  [0, 740, 1440, 740],
  [40, 60, 40, 180],
  [40, 180, 100, 180],
  [160, 180, 220, 180],
  [40, 280, 100, 280],
  [100, 280, 100, 180],
  [220, 230, 220, 280],
  [220, 280, 220, 740],
  [320, 205, 380, 205],
  [380, 205, 380, 100],
  [380, 100, 240, 100],
  [240, 100, 240, 180],
  [240, 180, 220, 180],
  [520, 60, 520, 160],
  [520, 160, 580, 160],
  [640, 160, 720, 160],
  [720, 160, 720, 60],
  [680, 160, 680, 220],
  [680, 280, 680, 740],
  [520, 340, 580, 340],
  [640, 340, 700, 340],
  [700, 340, 700, 400],
  [700, 460, 700, 740],
  [860, 60, 860, 200],
  [860, 260, 860, 380],
  [800, 380, 830, 380],
  [740, 380, 800, 380],
  [740, 340, 740, 380],
  [740, 340, 740, 60],
  [860, 420, 860, 480],
  [860, 540, 860, 740],
  [1020, 160, 1060, 160],
  [1020, 200, 1060, 200],
  [1020, 160, 1020, 60],
  [1020, 200, 980, 200],
  [980, 200, 980, 340],
  [980, 340, 1020, 340],
  [1020, 380, 1060, 380],
  [1120, 180, 1160, 180],
  [1220, 180, 1280, 180],
  [1280, 180, 1280, 60],
  [1060, 540, 1100, 540],
  [1060, 580, 1100, 580],
  [1060, 540, 1060, 460],
  [1060, 460, 1060, 60],
  [1060, 580, 1000, 580],
  [1000, 580, 1000, 740],
  [1200, 560, 1260, 560],
  [1260, 560, 1260, 460],
  [1260, 460, 1140, 460],
  [1140, 460, 1140, 540],
  [1140, 540, 1100, 540],
  [160, 60, 160, 160],
  [400, 740, 400, 600],
  [400, 600, 460, 600],
  [460, 600, 460, 500],
  [460, 500, 520, 500],
  [920, 400, 960, 400],
  [960, 400, 960, 300],
  [960, 300, 860, 300],
];

type CompType = "resistor" | "capacitor" | "ground" | "vcc" | "opamp" | "transistor" | "and" | "not";
interface Component {
  type: CompType;
  cx: number;
  cy: number;
  horiz?: boolean;
  label?: string;
}

const COMPONENTS: Component[] = [
  { type: "resistor", cx: 130, cy: 180, horiz: true, label: "R1" },
  { type: "resistor", cx: 290, cy: 100, horiz: true, label: "Rf" },
  { type: "opamp", cx: 270, cy: 205 },
  { type: "ground", cx: 220, cy: 740 },
  { type: "ground", cx: 40, cy: 740 },
  { type: "resistor", cx: 610, cy: 160, horiz: true, label: "R3" },
  { type: "capacitor", cx: 680, cy: 250, horiz: false, label: "C1" },
  { type: "resistor", cx: 610, cy: 340, horiz: true, label: "R4" },
  { type: "capacitor", cx: 700, cy: 430, horiz: false, label: "C2" },
  { type: "ground", cx: 680, cy: 740 },
  { type: "ground", cx: 700, cy: 740 },
  { type: "vcc", cx: 720, cy: 60 },
  { type: "resistor", cx: 860, cy: 230, horiz: false, label: "Rc" },
  { type: "resistor", cx: 770, cy: 380, horiz: true, label: "Rb" },
  { type: "transistor", cx: 860, cy: 400 },
  { type: "resistor", cx: 860, cy: 510, horiz: false, label: "Re" },
  { type: "ground", cx: 860, cy: 740 },
  { type: "and", cx: 1090, cy: 180 },
  { type: "not", cx: 1190, cy: 180 },
  { type: "resistor", cx: 1020, cy: 340, horiz: true, label: "R5" },
  { type: "vcc", cx: 1280, cy: 60 },
  { type: "opamp", cx: 1150, cy: 560 },
  { type: "resistor", cx: 1200, cy: 460, horiz: true, label: "Rf2" },
  { type: "ground", cx: 1000, cy: 740 },
  { type: "vcc", cx: 1060, cy: 60 },
];

const PULSE_WIRE_INDICES = [0, 1, 2, 7, 14, 21, 30, 37, 44, 50, 55, 4, 18, 25];

/** Canvas fillStyle/strokeStyle can't resolve CSS var() — needs a real value. */
const overlayRgbFor = (theme: string) => (theme === "dark" ? "255,255,255" : "5,5,5");

export default function PcbBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const overlayRgb = overlayRgbFor(theme);
    const ov = (alpha: number) => `rgba(${overlayRgb},${alpha})`;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const SX = () => canvas.width / 1440;
    const SY = () => canvas.height / 800;
    const cx = (x: number) => x * SX();
    const cy = (y: number) => y * SY();

    const drawStatic = () => {
      ctx.save();
      ctx.strokeStyle = ov(0.09);
      ctx.lineWidth = 1;
      for (const [x1, y1, x2, y2] of WIRES) {
        ctx.beginPath();
        ctx.moveTo(cx(x1), cy(y1));
        ctx.lineTo(cx(x2), cy(y2));
        ctx.stroke();
      }
      for (const comp of COMPONENTS) {
        drawComponent(ctx, comp, cx, cy, SX(), SY(), ov);
      }
      ctx.fillStyle = ov(0.18);
      const junctions = [[100,180],[240,180],[380,100],[680,160],[700,340],[860,300],[1060,540]];
      for (const [jx, jy] of junctions) {
        ctx.beginPath();
        ctx.arc(cx(jx), cy(jy), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const pulses: Pulse[] = PULSE_WIRE_INDICES.map((pathIndex, i) => ({
      pathIndex,
      progress: i / PULSE_WIRE_INDICES.length,
      speed: 0.0015 + Math.random() * 0.001,
    }));

    const drawPulse = (pulse: Pulse) => {
      const wire = WIRES[pulse.pathIndex];
      if (!wire) return;
      const [x1, y1, x2, y2] = wire;
      const px = cx(x1 + (x2 - x1) * pulse.progress);
      const py = cy(y1 + (y2 - y1) * pulse.progress);
      const grad = ctx.createRadialGradient(px, py, 0, px, py, 18);
      grad.addColorStop(0, "rgba(96,165,250,0.9)");
      grad.addColorStop(0.3, "rgba(96,165,250,0.4)");
      grad.addColorStop(1, "rgba(96,165,250,0)");
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(px, py, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "rgba(200,225,255,0.95)";
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    };

    let animFrame: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStatic();
      for (const pulse of pulses) {
        pulse.progress += pulse.speed;
        if (pulse.progress > 1) pulse.progress = 0;
        drawPulse(pulse);
      }
      animFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener("resize", resize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 0, pointerEvents: "none" }}
    />
  );
}

function drawComponent(ctx: CanvasRenderingContext2D, comp: Component, cx: (x: number) => number, cy: (y: number) => number, sx: number, sy: number, ov: (alpha: number) => string) {
  ctx.save();
  ctx.strokeStyle = ov(0.15);
  ctx.fillStyle = ov(0.12);
  ctx.lineWidth = 1;
  const x = cx(comp.cx);
  const y = cy(comp.cy);

  if (comp.type === "resistor") {
    const len = 30 * (comp.horiz ? sx : sy);
    const h = 6 * Math.min(sx, sy);
    ctx.beginPath();
    if (comp.horiz) {
      ctx.moveTo(x - len, y);
      ctx.lineTo(x - len * 0.7, y);
      const segs = 6;
      const segW = (len * 1.4) / segs;
      for (let i = 0; i <= segs; i++) {
        ctx.lineTo(x - len * 0.7 + i * segW, i % 2 === 0 ? y - h : y + h);
      }
      ctx.lineTo(x + len, y);
    } else {
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y - len * 0.7);
      const segs = 6;
      const segH = (len * 1.4) / segs;
      for (let i = 0; i <= segs; i++) {
        ctx.lineTo(i % 2 === 0 ? x - h : x + h, y - len * 0.7 + i * segH);
      }
      ctx.lineTo(x, y + len);
    }
    ctx.stroke();
    if (comp.label) {
      ctx.fillStyle = ov(0.18);
      ctx.font = `${9 * Math.min(sx, sy)}px monospace`;
      ctx.fillText(comp.label, x + 6 * sx, y - 8 * sy);
    }
  } else if (comp.type === "capacitor") {
    const len = 20 * (comp.horiz ? sx : sy);
    const gap = 4 * Math.min(sx, sy);
    const plateLen = 14 * Math.min(sx, sy);
    ctx.beginPath();
    if (comp.horiz) {
      ctx.moveTo(x - len, y); ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x - gap, y - plateLen); ctx.lineTo(x - gap, y + plateLen);
      ctx.moveTo(x + gap, y - plateLen); ctx.lineTo(x + gap, y + plateLen);
    } else {
      ctx.moveTo(x, y - len); ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap); ctx.lineTo(x, y + len);
      ctx.moveTo(x - plateLen, y - gap); ctx.lineTo(x + plateLen, y - gap);
      ctx.moveTo(x - plateLen, y + gap); ctx.lineTo(x + plateLen, y + gap);
    }
    ctx.stroke();
    if (comp.label) {
      ctx.fillStyle = ov(0.18);
      ctx.font = `${9 * Math.min(sx, sy)}px monospace`;
      ctx.fillText(comp.label, x + 8 * sx, y);
    }
  } else if (comp.type === "ground") {
    const w1 = 16*sx, w2 = 10*sx, w3 = 5*sx, s = 5*sy;
    ctx.beginPath();
    ctx.moveTo(x, y - 10*sy); ctx.lineTo(x, y);
    ctx.moveTo(x-w1, y); ctx.lineTo(x+w1, y);
    ctx.moveTo(x-w2, y+s); ctx.lineTo(x+w2, y+s);
    ctx.moveTo(x-w3, y+s*2); ctx.lineTo(x+w3, y+s*2);
    ctx.stroke();
  } else if (comp.type === "vcc") {
    ctx.beginPath();
    ctx.moveTo(x, y+10*sy); ctx.lineTo(x, y);
    ctx.moveTo(x-12*sx, y); ctx.lineTo(x+12*sx, y);
    ctx.stroke();
    ctx.fillStyle = ov(0.18);
    ctx.font = `${9 * Math.min(sx, sy)}px monospace`;
    ctx.fillText("VCC", x - 10*sx, y - 4*sy);
  } else if (comp.type === "opamp") {
    const w = 50*sx, h = 40*sy;
    ctx.beginPath();
    ctx.moveTo(x - w/2, y - h/2);
    ctx.lineTo(x + w/2, y);
    ctx.lineTo(x - w/2, y + h/2);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = ov(0.25);
    ctx.font = `${10 * Math.min(sx, sy)}px monospace`;
    ctx.fillText("+", x - w/2 + 4*sx, y + h/4 + 3*sy);
    ctx.fillText("−", x - w/2 + 4*sx, y - h/4 + 3*sy);
    ctx.fillStyle = ov(0.15);
    ctx.font = `${8 * Math.min(sx, sy)}px monospace`;
    ctx.fillText("U1", x - 6*sx, y - h/2 - 4*sy);
  } else if (comp.type === "transistor") {
    const s = 20 * Math.min(sx, sy);
    ctx.beginPath();
    ctx.moveTo(x, y-s); ctx.lineTo(x, y+s);
    ctx.moveTo(x-s, y); ctx.lineTo(x, y);
    ctx.moveTo(x, y-s*0.5); ctx.lineTo(x+s, y-s);
    ctx.moveTo(x, y+s*0.5); ctx.lineTo(x+s, y+s);
    ctx.stroke();
    ctx.fillStyle = ov(0.15);
    ctx.font = `${8 * Math.min(sx, sy)}px monospace`;
    ctx.fillText("Q1", x + s + 2*sx, y);
  } else if (comp.type === "and") {
    const w = 30*sx, h = 24*sy;
    ctx.beginPath();
    ctx.moveTo(x-w/2, y-h/2); ctx.lineTo(x, y-h/2);
    ctx.arc(x, y, h/2, -Math.PI/2, Math.PI/2);
    ctx.lineTo(x-w/2, y+h/2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x-w/2-12*sx, y-h/4); ctx.lineTo(x-w/2, y-h/4);
    ctx.moveTo(x-w/2-12*sx, y+h/4); ctx.lineTo(x-w/2, y+h/4);
    ctx.moveTo(x+h/2, y); ctx.lineTo(x+h/2+12*sx, y);
    ctx.stroke();
  } else if (comp.type === "not") {
    const w = 24*sx, h = 20*sy;
    ctx.beginPath();
    ctx.moveTo(x-w/2, y-h/2);
    ctx.lineTo(x+w/2-4*sx, y);
    ctx.lineTo(x-w/2, y+h/2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x+w/2+2*sx, y, 4*Math.min(sx,sy), 0, Math.PI*2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x-w/2-10*sx, y); ctx.lineTo(x-w/2, y);
    ctx.moveTo(x+w/2+6*sx, y); ctx.lineTo(x+w/2+16*sx, y);
    ctx.stroke();
  }

  ctx.restore();
}
