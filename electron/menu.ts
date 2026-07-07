/**
 * Native application menu (Phase 2, docs/DESKTOP_APP_PLAN.md). Mostly stock
 * roles so copy/paste, zoom, and window management behave natively; the one
 * custom entry is Settings (Cmd/Ctrl+,), which navigates the app window.
 */
import { app, Menu, type MenuItemConstructorOptions } from "electron";

export function installAppMenu(openSettings: () => void): void {
  const isMac = process.platform === "darwin";

  const settingsItem: MenuItemConstructorOptions = {
    label: isMac ? "Settings…" : "Settings",
    accelerator: "CmdOrCtrl+,",
    click: openSettings,
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              settingsItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...(isMac ? [] : [settingsItem, { type: "separator" } as const]),
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
