/**
 * Preload bridge: the only surface the renderer gets beyond the web page
 * itself. Presence of `window.resistanceDesktop` is how the Next app detects
 * it's running inside the desktop shell.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("resistanceDesktop", {
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke("settings:has-api-key"),
  /** Stores the key (OS-encrypted) and restarts the backend so it takes effect. */
  setApiKey: (key: string): Promise<void> =>
    ipcRenderer.invoke("settings:set-api-key", key),
  /** Native directory picker; null when the user cancels. */
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pick-folder"),
  /** Native file picker; null when the user cancels. */
  pickFile: (): Promise<string | null> => ipcRenderer.invoke("dialog:pick-file"),
  /** Open a file with its default application (e.g. a .pro in KiCad).
   *  Resolves to an error message, or "" on success. */
  openPath: (path: string): Promise<string> =>
    ipcRenderer.invoke("shell:open-path", path),
});
