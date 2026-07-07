/**
 * kicad-cli detection status for the settings page: resolves the manual
 * override (if set) or probes well-known install locations, and reports
 * what it found. Read-only; the override itself is set via PATCH /api/settings.
 */
import { NextResponse } from "next/server";

import { detectKicadCli } from "@/lib/kicad-cli";
import { getSettings } from "@/server/services/settings-service";

export async function GET() {
  const { kicadCliPath } = await getSettings();
  const detection = await detectKicadCli(kicadCliPath);
  return NextResponse.json(detection);
}
