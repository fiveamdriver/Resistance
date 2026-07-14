"use client";

/**
 * Settings surface (desktop Phase 2, docs/DESKTOP_APP_PLAN.md):
 * data-handling disclosure + per-tier off switches, Anthropic API key entry
 * (desktop shell only — stored OS-encrypted via the preload bridge), and
 * kicad-cli detection with a manual path override.
 */
import { useEffect, useState } from "react";

import type { AppSettings } from "@/server/services/settings-service";
import type { KicadCliDetection } from "@/lib/kicad-cli";
import { useTheme } from "@/components/theme-provider";

interface Props {
  initialSettings: AppSettings;
  initialKicadDetection: KicadCliDetection;
}

async function patchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to save settings");
  }
  return ((await res.json()) as { settings: AppSettings }).settings;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div>
        <p className="font-medium text-[var(--fg)]">{label}</p>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#2dd4bf]" : "bg-[rgba(var(--overlay-rgb),0.15)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--accent-bg)] transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-6">
      <h2 className="text-lg font-semibold text-[var(--fg)]">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsForm({ initialSettings, initialKicadDetection }: Props) {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);

  // Desktop-shell detection is client-only; render the key section after mount.
  const [desktop, setDesktop] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);

  const [kicad, setKicad] = useState(initialKicadDetection);
  const [kicadPathInput, setKicadPathInput] = useState(
    initialSettings.kicadCliPath ?? ""
  );
  const [kicadBusy, setKicadBusy] = useState(false);

  useEffect(() => {
    const bridge = window.resistanceDesktop;
    if (!bridge) return;
    setDesktop(true);
    void bridge.hasApiKey().then(setKeyConfigured);
  }, []);

  async function save(patch: Partial<AppSettings>) {
    setError(null);
    // Optimistic; a failed PATCH rolls back to the server's state.
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      setSettings(await patchSettings(patch));
    } catch (err) {
      setSettings(settings);
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  }

  async function refreshKicadDetection() {
    const res = await fetch("/api/settings/kicad-cli");
    if (res.ok) setKicad((await res.json()) as KicadCliDetection);
  }

  async function saveKicadPath(path: string | null) {
    setKicadBusy(true);
    try {
      await save({ kicadCliPath: path });
      setKicadPathInput(path ?? "");
      await refreshKicadDetection();
    } finally {
      setKicadBusy(false);
    }
  }

  async function browseKicadCli() {
    const picked = await window.resistanceDesktop?.pickFile();
    if (picked) await saveKicadPath(picked);
  }

  async function saveApiKey() {
    const key = keyInput.trim();
    if (!key || !window.resistanceDesktop) return;
    setKeySaving(true);
    setError(null);
    try {
      // Note: in the packaged app this restarts the local backend, which
      // reloads the window — the "Saving…" state ends with the reload.
      await window.resistanceDesktop.setApiKey(key);
      setKeyInput("");
      setKeyConfigured(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to store the key");
    } finally {
      setKeySaving(false);
    }
  }

  return (
    <div>
      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <Section title="Appearance">
        <Toggle
          checked={theme === "dark"}
          onChange={(dark) => setTheme(dark ? "dark" : "light")}
          label="Dark mode"
          description="Switch between the light (cream) and dark theme."
        />
      </Section>

      <Section title="AI & data sharing">
        <div className="mt-3 space-y-2 rounded-md border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.02)] p-4 text-sm text-[var(--fg-muted)]">
          <p className="font-medium text-[var(--fg)]">What leaves this machine</p>
          <p>
            <span className="text-[var(--fg)]">AI assistant and design review</span>{" "}
            send your board data — netlist, BOM, component and net details — to
            the Anthropic API to answer questions and produce findings.
          </p>
          <p>
            <span className="text-[var(--fg)]">Datasheet lookup</span> sends part
            numbers (MPNs) to the Anthropic API, which searches the web for
            datasheets, and downloads PDFs directly from manufacturer and
            distributor sites (your part numbers appear in those requests).
          </p>
          <p>
            Everything else — your files, parsed design data, and the project
            database — stays on this machine. With both switches off, nothing
            leaves it.
          </p>
        </div>

        <div className="mt-2 divide-y divide-[rgba(var(--overlay-rgb),0.06)]">
          <Toggle
            label="AI features"
            description="Assistant, design review, and datasheet spec lookup. Off = Resistance is a purely local design-data organizer."
            checked={settings.aiEnabled}
            onChange={(v) => void save({ aiEnabled: v })}
          />
          <Toggle
            label="Datasheet web fetch"
            description="Finding and downloading datasheets from the internet by part number. Off = datasheets come only from files you upload."
            checked={settings.datasheetFetchEnabled}
            onChange={(v) => void save({ datasheetFetchEnabled: v })}
          />
        </div>
      </Section>

      {desktop && (
        <Section title="Anthropic API key">
          <p className="mt-2 text-sm text-[var(--fg-muted)]">
            AI features run on your own Anthropic account. The key is stored
            encrypted by the operating system (Keychain on macOS) and never
            written to disk in plaintext.
          </p>
          <p className="mt-3 text-sm">
            {keyConfigured === null ? (
              <span className="text-[var(--fg-subtle)]">Checking…</span>
            ) : keyConfigured ? (
              <span className="text-[#2dd4bf]">✓ A key is configured</span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">
                No key configured — AI features are unavailable until you add
                one
              </span>
            )}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              className="flex-1 rounded-md border border-[rgba(var(--overlay-rgb),0.1)] bg-[var(--inset-bg)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-[rgba(var(--overlay-rgb),0.3)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void saveApiKey()}
              disabled={keySaving || !keyInput.trim()}
              className="rounded-md bg-[var(--accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] transition-all hover:bg-[var(--accent-bg-hover)] disabled:opacity-40"
            >
              {keySaving ? "Saving…" : keyConfigured ? "Replace key" : "Save key"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--fg-subtle)]">
            Saving restarts the local backend so the key takes effect.
          </p>
        </Section>
      )}

      <Section title="KiCad command-line tool">
        <p className="mt-2 text-sm text-[var(--fg-muted)]">
          Resistance uses <code className="text-[var(--fg)]">kicad-cli</code>{" "}
          (bundled with KiCad) to import projects directly from KiCad folders.
        </p>
        <p className="mt-3 text-sm">
          {kicad.cli ? (
            <span className="text-[#2dd4bf]">
              ✓ Found {kicad.cli.version} at{" "}
              <code className="break-all">{kicad.cli.path}</code>
              {kicad.cli.source === "override" && " (manual path)"}
            </span>
          ) : kicad.overrideError ? (
            <span className="text-red-700 dark:text-red-400">{kicad.overrideError}</span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">
              kicad-cli was not found. Install KiCad, or set the path manually
              below.
            </span>
          )}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={kicadPathInput}
            onChange={(e) => setKicadPathInput(e.target.value)}
            placeholder="Manual path, e.g. /Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
            className="flex-1 rounded-md border border-[rgba(var(--overlay-rgb),0.1)] bg-[var(--inset-bg)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-[rgba(var(--overlay-rgb),0.3)] focus:outline-none"
          />
          {desktop && (
            <button
              type="button"
              onClick={() => void browseKicadCli()}
              disabled={kicadBusy}
              className="rounded-md border border-[rgba(var(--overlay-rgb),0.15)] px-4 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[rgba(var(--overlay-rgb),0.3)] disabled:opacity-40"
            >
              Browse…
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveKicadPath(kicadPathInput.trim() || null)}
            disabled={kicadBusy}
            className="rounded-md bg-[var(--accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] transition-all hover:bg-[var(--accent-bg-hover)] disabled:opacity-40"
          >
            {kicadBusy ? "Checking…" : "Save"}
          </button>
        </div>
        {settings.kicadCliPath && (
          <button
            type="button"
            onClick={() => void saveKicadPath(null)}
            disabled={kicadBusy}
            className="mt-2 text-xs text-[var(--fg-muted)] underline-offset-2 hover:underline disabled:opacity-40"
          >
            Clear manual path and auto-detect
          </button>
        )}
      </Section>
    </div>
  );
}
