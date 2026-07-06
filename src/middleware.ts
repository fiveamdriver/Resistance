import { NextResponse, type NextRequest } from "next/server";

/**
 * Local API auth for the desktop shell (docs/DESKTOP_APP_PLAN.md, Phase 1).
 *
 * When the Electron main process spawns this server it sets
 * RESISTANCE_LOCAL_TOKEN and stamps the same token onto every request the
 * app window makes. Anything on the machine that isn't the app — another
 * process, a malicious webpage fetching localhost — lacks the token and is
 * rejected. When the env var is absent (plain `next dev` / web deployment),
 * this middleware is a no-op.
 */
const LOCAL_TOKEN = process.env.RESISTANCE_LOCAL_TOKEN;
const AUTH_HEADER = "x-resistance-token";

export function middleware(request: NextRequest): NextResponse {
  if (!LOCAL_TOKEN) return NextResponse.next();

  // Desktop mode binds to 127.0.0.1 only; a foreign Host header means DNS
  // rebinding or something equally unwelcome.
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    return new NextResponse("Forbidden", { status: 403 }) as NextResponse;
  }

  if (request.headers.get(AUTH_HEADER) !== LOCAL_TOKEN) {
    return new NextResponse("Unauthorized", { status: 401 }) as NextResponse;
  }

  return NextResponse.next();
}
