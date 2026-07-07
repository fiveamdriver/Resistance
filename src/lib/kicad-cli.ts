/**
 * kicad-cli discovery (desktop Phase 2, docs/DESKTOP_APP_PLAN.md).
 *
 * A naive `which kicad-cli` is not enough: macOS apps launched from the
 * Dock/Finder inherit a minimal PATH without Homebrew or
 * /Applications/KiCad/.../bin. So resolution is: the user's manual override
 * from settings first, then well-known install locations per platform, then
 * PATH as a last resort (covers terminal-launched dev mode). A candidate only
 * counts if `kicad-cli version` actually runs.
 */
import "server-only";

import { execFile } from "child_process";
import { existsSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface KicadCliInfo {
  path: string;
  version: string;
  /** How the binary was found: settings override, known location, or PATH. */
  source: "override" | "probed" | "path";
}

export interface KicadCliDetection {
  cli: KicadCliInfo | null;
  /** Set when a configured override exists but does not run. */
  overrideError?: string;
}

/** Well-known install locations, most specific first. */
function candidatePaths(): string[] {
  switch (process.platform) {
    case "darwin":
      return [
        "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
        path.join(os.homedir(), "Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"),
        "/opt/homebrew/bin/kicad-cli",
        "/usr/local/bin/kicad-cli",
      ];
    case "win32": {
      const candidates: string[] = [];
      for (const programFiles of [
        process.env.ProgramFiles ?? "C:\\Program Files",
        process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      ]) {
        const kicadRoot = path.join(programFiles, "KiCad");
        if (!existsSync(kicadRoot)) continue;
        // Versioned install dirs (…\KiCad\9.0\bin), newest first.
        let versions: string[] = [];
        try {
          versions = readdirSync(kicadRoot).sort().reverse();
        } catch {
          continue;
        }
        for (const version of versions) {
          candidates.push(path.join(kicadRoot, version, "bin", "kicad-cli.exe"));
        }
      }
      return candidates;
    }
    default:
      // Linux/BSD. Flatpak installs have no direct binary path — those users
      // set a wrapper script as the manual override.
      return [
        "/usr/bin/kicad-cli",
        "/usr/local/bin/kicad-cli",
        "/snap/bin/kicad-cli",
      ];
  }
}

/** Runs `<bin> version`; returns the version string or null if it won't run. */
async function probeVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ["version"], {
      timeout: 5_000,
    });
    const version = stdout.trim().split("\n")[0];
    return version || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a working kicad-cli. `overridePath` is the settings value
 * (AppSettings.kicadCliPath); a broken override is reported, not silently
 * skipped, so the settings UI can tell the user their path is wrong.
 */
export async function detectKicadCli(
  overridePath: string | null
): Promise<KicadCliDetection> {
  if (overridePath) {
    const version = await probeVersion(overridePath);
    if (version) {
      return { cli: { path: overridePath, version, source: "override" } };
    }
    return {
      cli: null,
      overrideError: `Configured path does not run: ${overridePath}`,
    };
  }

  for (const candidate of candidatePaths()) {
    if (!existsSync(candidate)) continue;
    const version = await probeVersion(candidate);
    if (version) {
      return { cli: { path: candidate, version, source: "probed" } };
    }
  }

  // Last resort: PATH (works when launched from a terminal with the user's
  // full shell environment).
  const version = await probeVersion("kicad-cli");
  if (version) {
    return { cli: { path: "kicad-cli", version, source: "path" } };
  }

  return { cli: null };
}
