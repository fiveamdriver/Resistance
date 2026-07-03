/**
 * GET /api/projects/[id]/render
 *
 * Renders the board via kicad-cli and streams back the image.
 *
 * Query params:
 *   side  — top|bottom|left|right|front|back  (default: top)
 *   layer — e.g. "F.Cu" for a 2D single-layer SVG (omit for 3D PNG)
 *   width — pixel width, capped at 1200  (default: 1200)
 *
 * Requires the project to have been synced from KiCad (sync_to_resistance
 * stamps kicadProjectDir into syncMeta). Returns 404 JSON if not synced yet.
 */
import "server-only";

import type { NextRequest } from "next/server";

import {
  getKicadProjectDir,
  renderBoard,
} from "@/server/services/kicad-service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const { searchParams } = request.nextUrl;

  const side = searchParams.get("side") ?? "top";
  const layer = searchParams.get("layer") ?? null;
  const width = Math.min(
    1200,
    Math.max(100, Number(searchParams.get("width") ?? "1200")),
  );

  const projectDir = await getKicadProjectDir(projectId);
  if (!projectDir) {
    return Response.json(
      {
        error:
          "KiCad project directory not found. Sync the project from KiCad first using sync_to_resistance.",
      },
      { status: 404 },
    );
  }

  try {
    const { data, format } = await renderBoard(projectDir, side, layer, width);
    const contentType = format === "svg" ? "image/svg+xml" : "image/png";
    return new Response(data.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Render failed" },
      { status: 500 },
    );
  }
}
