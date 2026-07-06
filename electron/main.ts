/**
 * Resistance desktop shell (Phase 1, docs/DESKTOP_APP_PLAN.md).
 *
 * Boot sequence: derive per-user data paths → downgrade guard → backup →
 * migrate → spawn the standalone Next server on an ephemeral localhost port
 * with a per-boot auth token → open a window on it. The server child runs on
 * Electron's own Node (ELECTRON_RUN_AS_NODE); no system Node is assumed.
 *
 * Dev mode (RESISTANCE_DESKTOP_DEV=1): skips server management and points the
 * window at an already-running `next dev` — no token, since the dev server
 * doesn't have one.
 */
import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import http from "http";
import net from "net";
import path from "path";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

import { assertNoDowngrade, backupDatabase, migrateDatabase } from "./db";
import { hasApiKey, loadApiKey, saveApiKey } from "./secrets";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEV_MODE =
  process.env.RESISTANCE_DESKTOP_DEV === "1" || process.argv.includes("--dev");
const DEV_URL = process.env.RESISTANCE_DESKTOP_DEV_URL ?? "http://localhost:3000";
const AUTH_HEADER = "x-resistance-token";

// Deterministic data location regardless of how the app was launched
// (`electron dist/main.js` would otherwise default the name to "Electron").
app.setName("Resistance");
app.setPath("userData", path.join(app.getPath("appData"), "Resistance"));

const token = randomBytes(32).toString("hex");
let serverProc: ChildProcess | null = null;
let win: BrowserWindow | null = null;
let baseUrl = "";
let quitting = false;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function waitForServer(port: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/projects",
          headers: { [AUTH_HEADER]: token },
        },
        (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          reject(new Error(`server answered ${res.statusCode} during boot`));
        }
      );
      req.on("error", () => {
        if (Date.now() - started > 30_000) {
          return reject(new Error("server did not answer within 30s"));
        }
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

async function startServer(dataDir: string): Promise<string> {
  const port = await getFreePort();
  const apiKey = loadApiKey(dataDir) ?? process.env.ANTHROPIC_API_KEY;

  serverProc = spawn(
    process.execPath,
    [path.join(REPO_ROOT, ".next", "standalone", "server.js")],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: `file:${path.join(dataDir, "resistance.db")}`,
        UPLOADS_DIR: path.join(dataDir, "uploads"),
        RESISTANCE_LOCAL_TOKEN: token,
        ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  serverProc.stdout?.on("data", (d: Buffer) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (!quitting) {
      dialog.showErrorBox(
        "Resistance backend stopped",
        `The local server exited unexpectedly (code ${code ?? "unknown"}). ` +
          "Please relaunch Resistance."
      );
      app.quit();
    }
  });

  await waitForServer(port);
  return `http://127.0.0.1:${port}`;
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProc) return resolve();
    serverProc.once("exit", () => resolve());
    serverProc.kill();
  });
}

/** Every request the window makes carries the per-boot token. */
function injectAuthHeader(origin: string): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/*`] },
    (details, callback) => {
      details.requestHeaders[AUTH_HEADER] = token;
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.once("ready-to-show", () => win?.show());

  // The window is for the local app only; anything else goes to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(baseUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void win.loadURL(`${baseUrl}/projects`);

  // Dev aid: RESISTANCE_SHOT=<path.png> writes a screenshot after load, so
  // headless checks (and agents) can see what the window actually rendered.
  const shotPath = process.env.RESISTANCE_SHOT;
  if (shotPath) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const img = await win?.webContents.capturePage();
        if (img) writeFileSync(shotPath, img.toPNG());
        console.log(`[shell] screenshot written to ${shotPath}`);
      }, 1500);
    });
  }
}

app.whenReady().then(async () => {
  const dataDir = app.getPath("userData");
  mkdirSync(path.join(dataDir, "uploads"), { recursive: true });

  ipcMain.handle("settings:has-api-key", () => hasApiKey(dataDir));
  ipcMain.handle("settings:set-api-key", async (_event, key: string) => {
    saveApiKey(dataDir, key);
    if (!DEV_MODE) {
      // Key is passed via child env, so a restart is what makes it live.
      await stopServer();
      baseUrl = await startServer(dataDir);
      injectAuthHeader(baseUrl);
      void win?.loadURL(`${baseUrl}/projects`);
    }
  });

  try {
    if (DEV_MODE) {
      baseUrl = DEV_URL;
    } else {
      const dbPath = path.join(dataDir, "resistance.db");
      const dbUrl = `file:${dbPath}`;
      assertNoDowngrade(REPO_ROOT, dbUrl);
      const backupDir = backupDatabase(dataDir, dbPath);
      migrateDatabase(REPO_ROOT, dbUrl, backupDir);
      baseUrl = await startServer(dataDir);
      injectAuthHeader(baseUrl);
    }
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      "Resistance could not start",
      err instanceof Error ? err.message : String(err)
    );
    app.exit(1);
  }
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", (event) => {
  if (serverProc) {
    event.preventDefault();
    void stopServer().then(() => app.quit());
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
