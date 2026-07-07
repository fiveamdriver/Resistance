/**
 * The desktop shell's preload bridge (electron/preload.ts). Present only when
 * the app runs inside Electron — feature-detect via
 * `typeof window !== "undefined" && window.resistanceDesktop`.
 */
interface ResistanceDesktopBridge {
  hasApiKey: () => Promise<boolean>;
  /** Stores the key (OS-encrypted) and restarts the backend so it takes effect. */
  setApiKey: (key: string) => Promise<void>;
  /** Native directory picker. Resolves null if the user cancels. */
  pickFolder: () => Promise<string | null>;
  /** Native file picker. Resolves null if the user cancels. */
  pickFile: () => Promise<string | null>;
}

interface Window {
  resistanceDesktop?: ResistanceDesktopBridge;
}
