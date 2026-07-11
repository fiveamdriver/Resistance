# Running the Resistance Desktop App

Everything needed to get the desktop app running on a Mac, plus fixes for
every problem we have actually hit doing it. Written 2026-07-10 after a long
night; follow it top to bottom on a new machine and you should not need any
of the troubleshooting section.

---

## One-time machine setup

**1. Node via nvm.** Use Node 22 (LTS). Do not rely on a Homebrew-installed
Node — it drifts ahead of what the project expects.

```sh
# install nvm if you do not have it: https://github.com/nvm-sh/nvm
# then make sure your shell actually loads it (nvm installs do not always do this):
echo 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> ~/.zshrc
```

Open a **new terminal** afterwards, then:

```sh
nvm install 22
nvm use 22
node -v
```

`node -v` must print `v22.x`. If your terminal says `command not found: nvm`,
the loader line above is missing from your `~/.zshrc`.

**2. Clone and install.**

```sh
git clone https://github.com/fiveamdriver/Resistance.git
cd Resistance
npm install
```

`npm install` takes a few minutes and finishes by generating the Prisma
client. It must be re-run whenever `package.json` changes after a pull.

---

## Launching the app (production mode — the normal way)

```sh
cd Resistance
nvm use 22
git pull
npm run desktop
```

What to expect:

- The terminal prints build output, then goes **quiet for several minutes**
  at `Creating an optimized production build ...`. Quiet is normal.
  On a machine with the single-threaded workaround (see troubleshooting)
  expect 5–15 minutes. Only treat it as hung past ~20 minutes.
- When the build finishes, the Resistance window opens automatically.
- The app runs its own local server with its **own database** stored in
  `~/Library/Application Support/Resistance` — separate from any dev data.
- The window lives as long as that terminal does. Closing the terminal or
  pressing Ctrl+C quits the app.

**Fast relaunch (no code changes since last build):**

```sh
npx electron electron/dist/main.js
```

Opens in seconds using the previous build. Only rebuild (`npm run desktop`)
after pulling new code.

**AI features (chat, design review, datasheets):** open **Settings** inside
the app and paste your Anthropic API key there. It is stored encrypted in
the macOS Keychain. Do not put the key in `.env` for production mode — the
Settings flow is the supported path. Without a key the app works fine but
AI features are unavailable.

---

## Dev mode (only when editing code)

Hot reload, uses the repo dev database and `.env` (including
`ANTHROPIC_API_KEY=` from `.env`, NOT the Settings key):

```sh
npm run dev            # terminal 1 — wait for "Ready"
npm run dev:desktop    # terminal 2 — opens the window against localhost:3000
```

Dev mode is for iterating on code. To evaluate the app the way a user sees
it, use production mode above.

---

## Troubleshooting

### `sh: next: command not found`
Dependencies are not installed in this checkout. Run `npm install`, then
retry. Happens on fresh clones and after switching checkouts.

### `zsh: command not found: nvm`
nvm is installed but not loaded. Add the loader line from step 1 to
`~/.zshrc` and open a new terminal.

### Build hangs forever at `Creating an optimized production build ...`
(No output AND near-zero CPU for 20+ minutes.) Some machines hit a deadlock
inside the SWC compiler when Next.js fans the build out to worker processes
— all threads park at 0% CPU and it never finishes. Fix: force the build
single-threaded by adding this to `next.config.ts`:

```ts
experimental: {
  workerThreads: false,
  cpus: 1,
},
```

Builds get slower but reliable. Keep this edit local (do not commit it) —
machines without the deadlock should keep parallel builds.

### Killing stuck or duplicate builds

```sh
pkill -f "next build"; pkill -f "next-server"; pkill -f "next dev"; pkill -f "electron"
pgrep -fl "next|electron" | grep -v grep    # no output = all clear
```

Never run two builds at once — they share the `.next` folder and corrupt
each other.

### `git pull` fails with `invalid refspec` or weird quoting errors
You pasted a command block whose comments contained an apostrophe, which
breaks zsh quoting. Retype the commands plainly, one per line, no comments.

### Sync errors mentioning `Unique constraint failed (projectId, refDes)`
Fixed in commit `a356181` (2026-07-10). If you see this, your checkout is
older than that — `git pull`, rebuild.

### AI design review says "No findings were raised" on a big board
Also fixed in `a356181` (review output was being truncated and silently
parsed as zero findings). Pull and rebuild; truncated runs now fail with a
clear error instead.

---

## Known machine-specific notes

- **Phoenix's MacBook Air:** needs the single-threaded build workaround
  (SWC deadlock reproduces on Node 22 and 26). His working checkout carries
  the `next.config.ts` edit locally.
- Node 24 also works (Lance's machine); Node 22 is the recommended baseline.
  Homebrew Node 26 has been nothing but trouble — use nvm.

## The real fix (future)

All of this exists because launching = rebuilding the repo. The endgame is a
packaged `Resistance.app` (electron-builder): build once, ship a normal Mac
app, no Node/nvm/build on user machines at all. Until then, this doc.
