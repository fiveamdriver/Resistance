import { detectKicadCli } from "@/lib/kicad-cli";
import { getSettings } from "@/server/services/settings-service";
import { SettingsForm } from "@/components/settings/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();
  const kicadDetection = await detectKicadCli(settings.kicadCliPath);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 pt-6">
      <h1 className="text-2xl font-bold text-[var(--fg)]">Settings</h1>
      <SettingsForm
        initialSettings={settings}
        initialKicadDetection={kicadDetection}
      />
    </div>
  );
}
