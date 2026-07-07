/**
 * Remembered window size/position (Phase 2, docs/DESKTOP_APP_PLAN.md).
 * Plain JSON in userData; corrupt or off-screen state falls back to defaults
 * rather than opening a window the user can't see.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { screen, type BrowserWindow, type Rectangle } from "electron";

export interface WindowState {
  bounds?: Rectangle;
  isMaximized?: boolean;
}

const DEFAULT_SIZE = { width: 1440, height: 900 };

function stateFile(dataDir: string): string {
  return path.join(dataDir, "window-state.json");
}

function isUsableBounds(bounds: Rectangle): boolean {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width < 400 ||
    bounds.height < 300
  ) {
    return false;
  }
  // The saved position must still be on a connected display (monitors get
  // unplugged between launches).
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x >= area.x - bounds.width + 100 &&
      bounds.x <= area.x + area.width - 100 &&
      bounds.y >= area.y &&
      bounds.y <= area.y + area.height - 100
    );
  });
}

export function loadWindowState(dataDir: string): {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
} {
  try {
    const file = stateFile(dataDir);
    if (existsSync(file)) {
      const state = JSON.parse(readFileSync(file, "utf8")) as WindowState;
      if (state.bounds && isUsableBounds(state.bounds)) {
        return { ...state.bounds, isMaximized: state.isMaximized ?? false };
      }
    }
  } catch {
    // Corrupt state file: fall through to defaults.
  }
  return { ...DEFAULT_SIZE, isMaximized: false };
}

/** Persist bounds on resize/move (debounced) and on close. */
export function trackWindowState(dataDir: string, win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const save = () => {
    if (win.isDestroyed()) return;
    const state: WindowState = {
      // getNormalBounds = the un-maximized rectangle, so un-maximizing after
      // a relaunch restores the right size.
      bounds: win.getNormalBounds(),
      isMaximized: win.isMaximized(),
    };
    try {
      writeFileSync(stateFile(dataDir), JSON.stringify(state));
    } catch {
      // Losing window state is not worth surfacing an error.
    }
  };
  const debouncedSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };

  win.on("resize", debouncedSave);
  win.on("move", debouncedSave);
  win.on("maximize", debouncedSave);
  win.on("unmaximize", debouncedSave);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
