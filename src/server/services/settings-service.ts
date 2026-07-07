/**
 * App-wide settings (desktop Phase 2 settings surface,
 * docs/DESKTOP_APP_PLAN.md).
 *
 * Owns the AppSetting key-value table: typed keys, defaults, and JSON
 * (de)serialization live here. These settings are the compliance off-switches
 * — services that send data off the machine (assistant, AI review, datasheet
 * enrichment/fetch) must check them via this module before doing so.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { parseOrThrow, updateSettingsSchema } from "@/lib/validation";

export interface AppSettings {
  /**
   * Master switch for everything that talks to the Anthropic API (assistant,
   * AI design review, datasheet enrichment). Off = the app is a purely local
   * design-data organizer; nothing leaves the machine.
   */
  aiEnabled: boolean;
  /**
   * Fetching datasheets from the network: Claude web-search enrichment (sends
   * MPN lists to Anthropic) and direct PDF downloads from third-party sites
   * (MPNs leak via URLs/User-Agent). Off = datasheets come from uploads only.
   */
  datasheetFetchEnabled: boolean;
  /** Manual kicad-cli path override; null = auto-detect (src/lib/kicad-cli.ts). */
  kicadCliPath: string | null;
}

export const SETTINGS_DEFAULTS: AppSettings = {
  aiEnabled: true,
  datasheetFetchEnabled: true,
  kicadCliPath: null,
};

const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof AppSettings)[];

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: SETTING_KEYS } },
  });
  const settings = { ...SETTINGS_DEFAULTS };
  for (const row of rows) {
    try {
      // Assigning through `unknown` because each key has its own value type.
      (settings as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    } catch {
      // Corrupt row: fall back to the default rather than failing every read.
    }
  }
  return settings;
}

export async function updateSettings(input: unknown): Promise<AppSettings> {
  const patch = parseOrThrow(
    updateSettingsSchema,
    input,
    "Invalid settings update"
  );
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.appSetting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      })
    )
  );
  return getSettings();
}
