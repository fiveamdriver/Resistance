/**
 * App settings — read and partial-update. Backs the /settings page (desktop
 * Phase 2). Business logic lives in the settings service; this layer only
 * handles HTTP.
 */
import { NextResponse } from "next/server";

import { toUserError } from "@/lib/errors";
import { getSettings, updateSettings } from "@/server/services/settings-service";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  try {
    const settings = await updateSettings(body);
    return NextResponse.json({ settings });
  } catch (error) {
    const { code, message, details } = toUserError(error);
    const status = code === "VALIDATION_ERROR" ? 400 : 500;
    return NextResponse.json({ error: message, details }, { status });
  }
}
