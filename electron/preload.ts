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
});
