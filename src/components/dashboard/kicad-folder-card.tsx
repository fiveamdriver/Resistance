"use client";

/**
 * Linked KiCad folder card (desktop Phase 4, docs/DESKTOP_APP_PLAN.md).
 *
 * Link a project folder (native picker in the desktop shell, manual path in
 * the browser), sync fresh kicad-cli exports on demand, browse the folder's
 * contents in a categorized import dialog, and toggle auto-sync. All the real
 * work happens server-side (folder-sync-service); this card is the front door.
 */
import { useCallback, useEffect, useState } from "react";
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

const buttonPrimary =
  "rounded-md bg-[#F5F0E8] px-3 py-1.5 text-sm font-semibold text-black transition-all hover:bg-[#F5F0E8]/90 disabled:opacity-40";
const buttonSecondary =
  "rounded-md border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-sm text-[#F5F0E8] transition-colors hover:border-[rgba(255,255,255,0.3)] disabled:opacity-40";

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
  const [checkedDocs, setCheckedDocs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDesktop(Boolean(window.resistanceDesktop));
  }, []);

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
      setScan(body.scan);
      setIncludeExports(Boolean(body.scan.eda));
      setCheckedDocs(new Set());
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
    try {
      const body = (await api(`/api/projects/${projectId}/folder-import`, {
        method: "POST",
        body: JSON.stringify({
          runExports: includeExports && Boolean(scan.eda),
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

  function toggleDoc(relPath: string) {
    setCheckedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
      {folder.path ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#F5F0E8]">
              KiCad folder linked
              {kicadSync && (
                <span className="ml-2 font-normal text-[#94a3b8]">
                  · synced {formatDate(kicadSync.syncedAt)}
                  {kicadSync.kicadVersion && ` · KiCad ${kicadSync.kicadVersion}`}
                </span>
              )}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-[#4a5568]" title={folder.path}>
              {folder.path}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-1 flex cursor-pointer items-center gap-2 text-xs text-[#94a3b8]">
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
              className="text-xs text-[#4a5568] underline-offset-2 hover:text-[#94a3b8] hover:underline"
            >
              Unlink
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#F5F0E8]">
              Link your KiCad project folder
            </p>
            <p className="mt-0.5 text-xs text-[#94a3b8]">
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
                className="w-full flex-1 rounded-md border border-[rgba(255,255,255,0.1)] bg-black/30 px-3 py-1.5 font-mono text-xs text-[#F5F0E8] placeholder:text-[#4a5568] focus:border-[rgba(255,255,255,0.3)] focus:outline-none sm:w-80"
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

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {notice && <p className="mt-2 text-xs text-[#2dd4bf]">{notice}</p>}

      {scan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => busy !== "import" && setScan(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#0c0c0e] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[#F5F0E8]">
              Import from folder
            </h3>
            <p className="mt-0.5 truncate font-mono text-xs text-[#4a5568]">
              {scan.folder}
            </p>

            {scan.eda ? (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3">
                <input
                  type="checkbox"
                  checked={includeExports}
                  onChange={(e) => setIncludeExports(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#2dd4bf]"
                />
                <span>
                  <span className="text-sm font-medium text-[#F5F0E8]">
                    Fresh {scan.eda.displayName} exports —{" "}
                    {scan.eda.exports.map((x) => x.filename).join(", ")}
                  </span>
                  <span className="mt-0.5 block text-xs text-[#94a3b8]">
                    Generated now from {scan.eda.schematic}
                    {scan.eda.generatorVersion &&
                      ` (KiCad ${scan.eda.generatorVersion})`}{" "}
                    and re-parsed. Replaces the previous sync&apos;s exports.
                  </span>
                </span>
              </label>
            ) : (
              <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-400">
                No KiCad project recognized in this folder — only documents can
                be imported.
              </p>
            )}

            {scan.documents.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[#4a5568]">
                  Documents in the folder
                </p>
                <ul className="mt-2 space-y-1">
                  {scan.documents.map((doc) => (
                    <li key={doc.relPath}>
                      <label className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-[rgba(255,255,255,0.03)]">
                        <input
                          type="checkbox"
                          checked={checkedDocs.has(doc.relPath)}
                          onChange={() => toggleDoc(doc.relPath)}
                          className="h-4 w-4 accent-[#2dd4bf]"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-[#F5F0E8]">
                          {doc.relPath}
                        </span>
                        {doc.alreadyImported && (
                          <span className="shrink-0 rounded-full border border-[rgba(255,255,255,0.12)] px-2 py-0.5 text-[10px] text-[#4a5568]">
                            already imported
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-[#4a5568]">
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
                <summary className="cursor-pointer text-xs text-[#4a5568] hover:text-[#94a3b8]">
                  Show all other files ({scan.other.length}
                  {scan.otherTruncated ? "+" : ""}) — not importable
                </summary>
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto pl-2">
                  {scan.other.map((f) => (
                    <li
                      key={f.relPath}
                      className="truncate font-mono text-xs text-[#4a5568]"
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
                disabled={
                  busy === "import" ||
                  (!includeExports && checkedDocs.size === 0) ||
                  (!scan.eda && checkedDocs.size === 0)
                }
                className={buttonPrimary}
              >
                {busy === "import"
                  ? "Importing…"
                  : `Import ${
                      (includeExports && scan.eda ? scan.eda.exports.length : 0) +
                      checkedDocs.size
                    } file${
                      (includeExports && scan.eda ? scan.eda.exports.length : 0) +
                        checkedDocs.size ===
                      1
                        ? ""
                        : "s"
                    }`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
