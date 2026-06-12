"use client";
import { useEffect, useRef } from "react";

type Pt = [number, number];

// Orthogonal PCB trace paths — design grid 1440 × 800
const TRACES: Pt[][] = [
  // === TOP BAND ===
  [[0, 80], [240, 80], [240, 160], [480, 160]],
  [[360, 0], [360, 80], [600, 80]],
  [[600, 80], [840, 80], [840, 0]],
  [[960, 80], [1200, 80], [1200, 160]],
  [[1080, 0], [1080, 80]],
  [[1320, 0], [1320, 80], [1440, 80]],
  [[0, 160], [120, 160], [120, 80]],
  [[480, 160], [720, 160], [720, 80]],
  [[1200, 160], [1320, 160], [1440, 160]],
  // === BAND 2 ===
  [[0, 240], [360, 240], [360, 160]],
  [[480, 240], [600, 240], [600, 160]],
  [[720, 240], [840, 240], [840, 160]],
  [[960, 240], [1080, 240], [1080, 160]],
  [[1200, 240], [1320, 240], [1320, 160]],
  // === BAND 3 ===
  [[0, 320], [240, 320], [240, 240]],
  [[360, 320], [480, 320], [480, 240]],
  [[600, 320], [720, 320], [720, 240]],
  [[840, 320], [960, 320], [960, 240]],
  [[1080, 320], [1200, 320], [1200, 240]],
  [[1320, 320], [1440, 320]],
  // === BAND 4 ===
  [[0, 400], [360, 400], [360, 320]],
  [[480, 400], [600, 400], [600, 320]],
  [[720, 400], [840, 400], [840, 320]],
  [[960, 400], [1080, 400], [1080, 320]],
  [[1200, 400], [1320, 400], [1320, 320]],
  // === BAND 5 ===
  [[0, 480], [240, 480], [240, 400]],
  [[360, 480], [480, 480], [480, 400]],
  [[600, 480], [720, 480], [720, 400]],
  [[840, 480], [960, 480], [960, 400]],
  [[1080, 480], [1200, 480], [1200, 400]],
  [[1320, 480], [1440, 480]],
  // === BAND 6 ===
  [[0, 560], [360, 560], [360, 480]],
  [[480, 560], [600, 560], [600, 480]],
  [[720, 560], [840, 560], [840, 480]],
  [[960, 560], [1080, 560], [1080, 480]],
  [[1200, 560], [1440, 560]],
  // === BAND 7 ===
  [[0, 640], [240, 640], [240, 560]],
  [[360, 640], [480, 640], [480, 560]],
  [[600, 640], [720, 640], [720, 560]],
  [[840, 640], [960, 640], [960, 560]],
  [[1080, 640], [1200, 640], [1200, 560]],
  [[1320, 640], [1440, 640]],
  // === BAND 8 ===
  [[0, 720], [360, 720], [360, 640]],
  [[480, 720], [600, 720], [600, 640]],
  [[720, 720], [840, 720], [840, 640]],
  [[960, 720], [1080, 720], [1080, 640]],
  [[1200, 720], [1440, 720]],
  // === BOTTOM STUBS ===
  [[120, 800], [120, 720]],
  [[360, 800], [360, 720]],
  [[600, 800], [600, 720]],
  [[840, 800], [840, 720]],
  [[1080, 800], [1080, 720]],
  [[1320, 800], [1320, 720]],
];

// Solder pads at non-edge waypoints
const PADS: Pt[] = (() => {
  const seen = new Map<string, Pt>();
  TRACES.forEach((tr) =>
    tr.forEach(([x, y]) => {
      if (x !== 0 && x !== 1440 && y !== 0 && y !== 800)
        seen.set(`${x},${y}`, [x, y]);
    })
  );
  return Array.from(seen.values());
})();

// Precompute segment lengths for fast pointAt() lookup
const TRACE_META = TRACES.map((trace) => {
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < trace.length; i++) {
    const d = Math.hypot(trace[i][0] - trace[i - 1][0], trace[i][1] - trace[i - 1][1]);
    segs.push(d);
    total += d;
  }
  return { total, segs };
});

function pointAt(ti: number, t: number): Pt {
  const trace = TRACES[ti];
  const { total, segs } = TRACE_META[ti];
  let dist = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i]) {
      const f = dist / segs[i];
      return [
        trace[i][0] + (trace[i + 1][0] - trace[i][0]) * f,
        trace[i][1] + (trace[i + 1][1] - trace[i][1]) * f,
      ];
    }
    dist -= segs[i];
  }
  return trace[trace.length - 1];
}

// [traceIndex, durationSecs, delaySecs]
const PULSES: [number, number, number][] = [
  [0, 5.2, 0.0],
  [3, 4.1, 1.8],
  [7, 3.8, 0.4],
  [9, 5.8, 3.2],
  [11, 4.4, 1.0],
  [14, 5.0, 4.6],
  [17, 4.2, 2.4],
  [20, 6.1, 0.8],
  [22, 4.7, 5.2],
  [25, 5.3, 2.0],
  [28, 4.0, 3.8],
  [31, 5.6, 1.4],
  [33, 4.3, 0.2],
  [36, 5.1, 4.0],
  [39, 4.8, 2.6],
  [42, 5.5, 1.2],
  [44, 4.1, 3.4],
  [45, 5.9, 0.6],
];

const TRAIL_LEN = 0.11; // fraction of path behind head
const TRAIL_STEPS = 14;

export default function PCBBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rawCtx = canvas.getContext("2d");
    if (!rawCtx) return;
    // Rebind as non-nullable so TypeScript doesn't complain inside the frame closure
    const ctx: CanvasRenderingContext2D = rawCtx;

    let w = 0, h = 0, scale = 1, ox = 0, oy = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx = w / 1440, sy = h / 800;
      scale = Math.max(sx, sy);
      ox = (w - 1440 * scale) / 2;
      oy = (h - 800 * scale) / 2;
    };
    resize();
    window.addEventListener("resize", resize);

    // Convert design-space coords to canvas CSS-pixel coords
    const c = (x: number, y: number): [number, number] => [
      x * scale + ox,
      y * scale + oy,
    ];

    // Pulse progress state — start negative to simulate initial delay
    const states = PULSES.map(([, dur, delay]) => ({ t: -(delay / dur) }));

    let lastTs = performance.now();
    let animId: number;

    function frame(now: number) {
      const dt = (now - lastTs) / 1000;
      lastTs = now;

      ctx.clearRect(0, 0, w, h);

      // ── Static traces ──────────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = Math.max(0.75, scale * 0.8);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      TRACES.forEach((tr) => {
        ctx.beginPath();
        const [x0, y0] = c(tr[0][0], tr[0][1]);
        ctx.moveTo(x0, y0);
        for (let i = 1; i < tr.length; i++) {
          const [xi, yi] = c(tr[i][0], tr[i][1]);
          ctx.lineTo(xi, yi);
        }
        ctx.stroke();
      });

      // ── Solder pads ────────────────────────────────────────────────────────
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      PADS.forEach(([x, y]) => {
        const [cx, cy] = c(x, y);
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5 * scale, 0, Math.PI * 2);
        ctx.fill();
      });

      // ── Animated pulses ────────────────────────────────────────────────────
      PULSES.forEach(([ti, dur], i) => {
        states[i].t += dt / dur;
        if (states[i].t >= 1) states[i].t -= 1;
        const t = states[i].t;
        if (t < 0) return; // still in initial delay

        const headT = Math.min(t, 0.96);

        // Fading trail dots
        for (let s = TRAIL_STEPS; s >= 0; s--) {
          const tTrail = headT - (s / TRAIL_STEPS) * TRAIL_LEN;
          if (tTrail < 0) continue;
          const alpha = ((TRAIL_STEPS - s) / TRAIL_STEPS) * 0.5;
          const [px, py] = c(...pointAt(ti, tTrail));
          ctx.beginPath();
          ctx.arc(px, py, 1.5 * scale, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(96,165,250,${alpha.toFixed(3)})`;
          ctx.fill();
        }

        // Soft glow halo
        const [hx, hy] = c(...pointAt(ti, headT));
        const glowR = 9 * scale;
        const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, glowR);
        grad.addColorStop(0, "rgba(96,165,250,0.45)");
        grad.addColorStop(1, "rgba(96,165,250,0)");
        ctx.beginPath();
        ctx.arc(hx, hy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Bright center dot
        ctx.beginPath();
        ctx.arc(hx, hy, 2 * scale, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(191,219,254,0.95)";
        ctx.fill();
      });

      animId = requestAnimationFrame(frame);
    }

    animId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none"
      style={{ position: "fixed", inset: 0, zIndex: 0 }}
    />
  );
}
