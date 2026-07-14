"use client";

/**
 * Linked KiCad folder card (desktop Phase 4, docs/DESKTOP_APP_PLAN.md).
 *
 * Link a project folder (native picker in the desktop shell, manual path in
 * the browser), sync fresh kicad-cli exports on demand, browse the folder's
 * contents in a categorized import dialog, and toggle auto-sync. All the real
 * work happens server-side (folder-sync-service); this card is the front door.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { formatBytes, formatDate } from "@/lib/format";
import type { FolderScan } from "@/server/services/folder-sync-service";
import type { DashboardVM } from "./view-models";

interface Props {
  projectId: string;
  folder: DashboardVM["kicadFolder"];
  kicadSync: DashboardVM["kicadSync"];
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

/**
 * Which scanned documents start checked. Goal: one-click import of what's
 * relevant to THIS board without conflating boards or ingesting junk —
 * a multi-board repo is full of other boards' stale exports, and loose
 * .csv files are as likely flight logs as BOMs.
 *
 * - Files under a different detected board's directory: never pre-checked.
 * - Netlists: only when there's nothing to sync (a fresh export supersedes
 *   any stale .net lying in the folder).
 * - BOM-category files: only in the selected board's directory, or when the
 *   filename actually says "bom".
 * - PDFs / Altium docs / data CSVs (content-sniffed telemetry, calibration):
 *   pre-checked — all ingest cleanly and aren't board-conflating.
 * - Generic .txt/.md: never pre-checked (notes and build junk).
 */
function defaultCheckedDocs(scan: FolderScan, selectedRelDir: string | null): string[] {
  const boardDirs = [
    ...scan.edaProjects.map((p) => p.relDir),
    ...scan.legacyProjects.map((l) => l.relDir),
  ].filter((d) => d !== "");

  return scan.documents
    .filter((doc) => {
      if (doc.alreadyImported || doc.category === "document") return false;
      const owner = boardDirs.find((d) => doc.relPath.startsWith(d + "/"));
      const foreign = owner !== undefined && owner !== selectedRelDir;
      if (foreign) return false;
      // Netlists and board files are per-board connectivity sources: only
      // pre-checked when nothing is syncable (fresh exports beat stale files).
      if (doc.category === "netlist" || doc.category === "board") {
        return scan.edaProjects.length === 0;
      }
      if (doc.category === "bom") {
        return (
          (owner !== undefined && owner === selectedRelDir) ||
          /bom/i.test(doc.relPath.split("/").pop() ?? "")
        );
      }
      return true; // pdf, altium, data
    })
    .map((doc) => doc.relPath);
}

const buttonPrimary =
  "rounded-md bg-[var(--accent-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-fg)] transition-all hover:bg-[var(--accent-bg-hover)] disabled:opacity-40";
const buttonSecondary =
  "rounded-md border border-[rgba(var(--overlay-rgb),0.15)] px-3 py-1.5 text-sm text-[var(--fg)] transition-colors hover:border-[rgba(var(--overlay-rgb),0.3)] disabled:opacity-40";

export function KicadFolderCard({ projectId, folder, kicadSync }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "link" | "sync" | "scan" | "import">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [desktop, setDesktop] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [showPathInput, setShowPathInput] = useState(false);

  const [scan, setScan] = useState<FolderScan | null>(null);
  const [includeExports, setIncludeExports] = useState(true);
  /** relDir of the EDA project to export when the folder holds several. */
  const [selectedEda, setSelectedEda] = useState<string | null>(null);
  const [checkedDocs, setCheckedDocs] = useState<Set<string>>(new Set());
  /** Legacy board sent to KiCad via "Open in KiCad" — watched for conversion. */
  const [converting, setConverting] = useState<{ relDir: string; name: string } | null>(null);
  const convertingRef = useRef(converting);
  convertingRef.current = converting;

  useEffect(() => {
    setDesktop(Boolean(window.resistanceDesktop));
  }, []);

  // After "Open in KiCad", watch the folder for the conversion (the new
  // .kicad_sch makes the board detectable) and sync it the moment it lands —
  // the engineer saves in KiCad and comes back to an already-imported board.
  useEffect(() => {
    if (!converting) return;
    const started = Date.now();
    const CONVERSION_WATCH_MS = 10 * 60_000;

    const timer = setInterval(() => {
      void (async () => {
        const watching = convertingRef.current;
        if (!watching) return;
        if (Date.now() - started > CONVERSION_WATCH_MS) {
          setConverting(null);
          return;
        }
        let match = false;
        try {
          const body = (await api(`/api/projects/${projectId}/folder-scan`)) as {
            scan: FolderScan;
          };
          match = body.scan.edaProjects.some((p) => p.relDir === watching.relDir);
        } catch {
          return; // transient scan failure — keep watching
        }
        if (!match || convertingRef.current !== watching) return;

        setConverting(null);
        setNotice(`${watching.name} conversion detected — importing fresh exports…`);
        try {
          await api(`/api/projects/${projectId}/folder-import`, {
            method: "POST",
            body: JSON.stringify({ runExports: true, projectDir: watching.relDir }),
          });
          setNotice(
            `${watching.name} converted and synced — netlist and BOM imported.`
          );
          setScan(null);
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Auto-sync failed");
        }
      })();
    }, 5000);

    return () => clearInterval(timer);
  }, [converting, projectId, router]);

  const patchProject = useCallback(
    async (body: Record<string, unknown>) => {
      await api(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      router.refresh();
    },
    [projectId, router]
  );

  async function linkFolder(path: string) {
    setBusy("link");
    setError(null);
    try {
      await patchProject({ kicadProjectPath: path });
      setShowPathInput(false);
      setPathInput("");
      setNotice(null);
      // Linking should flow straight into ingesting: show everything the
      // folder has to offer, pre-selected, one click from imported.
      await openImportDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link folder");
    } finally {
      setBusy(null);
    }
  }

  async function pickAndLink() {
    const picked = await window.resistanceDesktop?.pickFolder();
    if (picked) await linkFolder(picked);
  }

  async function syncNow() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const body = (await api(`/api/projects/${projectId}/folder-import`, {
        method: "POST",
        body: JSON.stringify({ runExports: true }),
      })) as { result: { exports: { fileName: string; ok: boolean; parseStatus?: string }[] } };
      const parsed = body.result.exports.filter((e) => e.ok && e.parseStatus === "parsed");
      setNotice(
        `Synced ${parsed.length}/${body.result.exports.length} fresh exports from KiCad.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function openImportDialog() {
    setBusy("scan");
    setError(null);
    setNotice(null);
    try {
      const body = (await api(`/api/projects/${projectId}/folder-scan`)) as {
        scan: FolderScan;
      };
      const projects = body.scan.edaProjects;
      const selected =
        (projects.find((p) => p.previouslySynced) ?? projects[0])?.relDir ?? null;
      setScan(body.scan);
      setIncludeExports(projects.length > 0);
      setSelectedEda(selected);
      setCheckedDocs(new Set(defaultCheckedDocs(body.scan, selected)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    if (!scan) return;
    setBusy("import");
    setError(null);
    const runExports = includeExports && selectedEda !== null;
    try {
      const body = (await api(`/api/projects/${projectId}/folder-import`, {
        method: "POST",
        body: JSON.stringify({
          runExports,
          ...(runExports ? { projectDir: selectedEda } : {}),
          files: [...checkedDocs],
        }),
      })) as {
        result: {
          exports: { ok: boolean }[];
          documents: { ok: boolean }[];
        };
      };
      const okCount =
        body.result.exports.filter((o) => o.ok).length +
        body.result.documents.filter((o) => o.ok).length;
      setScan(null);
      setNotice(`Imported ${okCount} file${okCount === 1 ? "" : "s"} from the folder.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  const selectedProject =
    scan?.edaProjects.find((p) => p.relDir === selectedEda) ?? null;
  const importCount =
    (includeExports && selectedProject ? selectedProject.exports.length : 0) +
    checkedDocs.size;

  function toggleDoc(relPath: string) {
    setCheckedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] p-4">
      {folder.path ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--fg)]">
              KiCad folder linked
              {kicadSync && (
                <span className="ml-2 font-normal text-[var(--fg-muted)]">
                  · synced {formatDate(kicadSync.syncedAt)}
                  {kicadSync.kicadVersion && ` · KiCad ${kicadSync.kicadVersion}`}
                </span>
              )}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-[var(--fg-subtle)]" title={folder.path}>
              {folder.path}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-1 flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-muted)]">
              <input
                type="checkbox"
                checked={folder.autoSyncEnabled}
                onChange={(e) =>
                  void patchProject({ autoSyncEnabled: e.target.checked }).catch(
                    (err: unknown) =>
                      setError(err instanceof Error ? err.message : "Update failed")
                  )
                }
                className="h-3.5 w-3.5 accent-[#2dd4bf]"
              />
              Auto-sync on changes
            </label>
            {desktop && kicadSync?.kicadProjectFile && (
              <button
                type="button"
                onClick={() =>
                  void window
                    .resistanceDesktop!.openPath(kicadSync.kicadProjectFile!)
                    .then((err) => {
                      if (err) setError(err);
                    })
                }
                disabled={busy !== null}
                className={buttonSecondary}
                title="Open the synced KiCad project — edits sync back on save (auto-sync) or via Sync now"
              >
                Open in KiCad
              </button>
            )}
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={busy !== null}
              className={buttonPrimary}
            >
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              onClick={() => void openImportDialog()}
              disabled={busy !== null}
              className={buttonSecondary}
            >
              {busy === "scan" ? "Scanning…" : "Import files…"}
            </button>
            <button
              type="button"
              onClick={() =>
                void patchProject({ kicadProjectPath: null }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "Unlink failed")
                )
              }
              disabled={busy !== null}
              className="text-xs text-[var(--fg-subtle)] underline-offset-2 hover:text-[var(--fg-muted)] hover:underline"
            >
              Unlink
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--fg)]">
              Link your KiCad project folder
            </p>
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
              Import the netlist, BOM, and project documents straight from the
              folder — no manual exports.
            </p>
          </div>
          {desktop ? (
            <button
              type="button"
              onClick={() => void pickAndLink()}
              disabled={busy !== null}
              className={buttonPrimary}
            >
              {busy === "link" ? "Linking…" : "Link KiCad folder…"}
            </button>
          ) : showPathInput ? (
            <div className="flex w-full gap-2 sm:w-auto">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="/absolute/path/to/kicad/project"
                className="w-full flex-1 rounded-md border border-[rgba(var(--overlay-rgb),0.1)] bg-[var(--inset-bg)] px-3 py-1.5 font-mono text-xs text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-[rgba(var(--overlay-rgb),0.3)] focus:outline-none sm:w-80"
              />
              <button
                type="button"
                onClick={() => void linkFolder(pathInput.trim())}
                disabled={busy !== null || !pathInput.trim()}
                className={buttonPrimary}
              >
                {busy === "link" ? "Linking…" : "Link"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPathInput(true)}
              className={buttonPrimary}
            >
              Link KiCad folder…
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      {notice && <p className="mt-2 text-xs text-[#2dd4bf]">{notice}</p>}

      {scan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => busy !== "import" && setScan(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[rgba(var(--overlay-rgb),0.12)] bg-[#0c0c0e] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--fg)]">
              Import from folder
            </h3>
            <p className="mt-0.5 truncate font-mono text-xs text-[var(--fg-subtle)]">
              {scan.folder}
            </p>

            {scan.edaProjects.length > 0 ? (
              <div className="mt-4 rounded-md border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.02)] p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={includeExports}
                    onChange={(e) => setIncludeExports(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#2dd4bf]"
                  />
                  <span className="text-sm font-medium text-[var(--fg)]">
                    Fresh {scan.edaProjects[0].displayName} exports
                    {scan.edaProjects.length === 1 &&
                      ` — ${scan.edaProjects[0].exports.map((x) => x.filename).join(", ")}`}
                  </span>
                </label>
                {scan.edaProjects.length > 1 ? (
                  <div className="mt-2 space-y-1 pl-7">
                    <p className="text-xs text-[var(--fg-muted)]">
                      {scan.edaProjects.length} projects found — a Resistance
                      project tracks one board, pick which to sync:
                    </p>
                    {scan.edaProjects.map((p) => (
                      <label
                        key={p.relDir}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-[rgba(var(--overlay-rgb),0.03)]"
                      >
                        <input
                          type="radio"
                          name="eda-project"
                          checked={selectedEda === p.relDir}
                          onChange={() => {
                            setSelectedEda(p.relDir);
                            // Board choice changed — re-derive which documents
                            // are relevant to the newly selected board.
                            setCheckedDocs(new Set(defaultCheckedDocs(scan, p.relDir)));
                          }}
                          disabled={!includeExports}
                          className="h-3.5 w-3.5 accent-[#2dd4bf]"
                        />
                        <span className="text-sm text-[var(--fg)]">{p.name}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--fg-subtle)]">
                          {p.relDir || "."}
                        </span>
                        {p.previouslySynced && (
                          <span className="shrink-0 rounded-full border border-[rgba(var(--overlay-rgb),0.12)] px-2 py-0.5 text-[10px] text-[#2dd4bf]">
                            last synced
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 pl-7 text-xs text-[var(--fg-muted)]">
                    Generated now from {scan.edaProjects[0].schematic}
                    {scan.edaProjects[0].generatorVersion &&
                      ` (KiCad ${scan.edaProjects[0].generatorVersion})`}{" "}
                    and re-parsed. Replaces the previous sync&apos;s exports.
                  </p>
                )}
              </div>
            ) : scan.legacyProjects.length === 0 ? (
              <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                No KiCad project recognized in this folder — only documents can
                be imported.
              </p>
            ) : null}

            {scan.legacyProjects.length > 0 && (
              <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                <p>
                  {scan.legacyProjects.length === 1
                    ? "This project was made with an old KiCad (version 5 or earlier), which can't be synced directly."
                    : `${scan.legacyProjects.length} projects here were made with an old KiCad (version 5 or earlier), which can't be synced directly.`}{" "}
                  You can either check a board file (.kicad_pcb) below to import
                  its components and connections as-is, or convert a project to
                  get live syncing:
                </p>
                <ol className="mt-2 list-decimal space-y-0.5 pl-4">
                  <li>
                    Open the project in KiCad
                    {desktop ? " (button below)" : " (File → Open Project)"}.
                  </li>
                  <li>
                    Double-click the schematic in KiCad&apos;s file tree; if a
                    &ldquo;rescue&rdquo; window appears, accept it.
                  </li>
                  <li>
                    Save (Cmd+S) — Resistance detects the conversion and
                    imports the board automatically.
                  </li>
                </ol>
                <ul className="mt-2 space-y-1">
                  {scan.legacyProjects.map((l) => (
                    <li key={l.relDir} className="flex items-center gap-2">
                      <span className="font-medium">{l.name}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-amber-700/70 dark:text-amber-700 dark:text-amber-400/60">
                        {l.proRelPath ?? l.relDir}
                      </span>
                      {desktop && l.proRelPath && (
                        <button
                          type="button"
                          onClick={() =>
                            void window
                              .resistanceDesktop!.openPath(
                                `${scan.folder}/${l.proRelPath}`
                              )
                              .then((err) => {
                                if (err) {
                                  setError(err);
                                } else {
                                  // Watch for the save in KiCad; sync lands
                                  // automatically once conversion is detected.
                                  setConverting({ relDir: l.relDir, name: l.name });
                                }
                              })
                          }
                          className="shrink-0 rounded border border-amber-500/40 px-2 py-0.5 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                        >
                          {converting?.relDir === l.relDir
                            ? "Waiting for save…"
                            : "Open in KiCad"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {scan.documents.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                  Documents in the folder
                </p>
                <ul className="mt-2 space-y-1">
                  {scan.documents.map((doc) => (
                    <li key={doc.relPath}>
                      <label className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-[rgba(var(--overlay-rgb),0.03)]">
                        <input
                          type="checkbox"
                          checked={checkedDocs.has(doc.relPath)}
                          onChange={() => toggleDoc(doc.relPath)}
                          className="h-4 w-4 accent-[#2dd4bf]"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg)]">
                          {doc.relPath}
                        </span>
                        {doc.alreadyImported && (
                          <span className="shrink-0 rounded-full border border-[rgba(var(--overlay-rgb),0.12)] px-2 py-0.5 text-[10px] text-[var(--fg-subtle)]">
                            already imported
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-[var(--fg-subtle)]">
                          {formatBytes(doc.sizeBytes)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {scan.other.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]">
                  Show all other files ({scan.other.length}
                  {scan.otherTruncated ? "+" : ""}) — not importable
                </summary>
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto pl-2">
                  {scan.other.map((f) => (
                    <li
                      key={f.relPath}
                      className="truncate font-mono text-xs text-[var(--fg-subtle)]"
                    >
                      {f.relPath} · {formatBytes(f.sizeBytes)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setScan(null)}
                disabled={busy === "import"}
                className={buttonSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={busy === "import" || importCount === 0}
                className={buttonPrimary}
              >
                {busy === "import"
                  ? "Importing…"
                  : `Import ${importCount} file${importCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
