# Test Plan — AI Design Review & Altium Import

Covers the two features added on 2026-06-15:

1. **AI Design Review** (Reports tab + `/api/projects/[id]/review`)
2. **Altium `.SchDoc` / `.PcbDoc` import** (upload pipeline + validation)

Legend: **[Auto]** = automated/CLI, **[UI]** = manual in the browser, **[API]** = curl.

---

## 0. Preconditions

```bash
# from the project root
npm install
npm run setup          # generates client, pushes schema (incl. ReviewRun/Finding), seeds demo data
```

- The AI review needs a key: put `ANTHROPIC_API_KEY=sk-ant-...` in `.env.local`.
- Tests that exercise the _live LLM_ are marked **(needs key)**. Everything else works without one.
- Start the app for UI/API tests: `npm run dev` → http://localhost:3000
- **Gotcha:** don't run `npm run build` and then `npm run dev` against the same checkout without clearing the cache in between — it corrupts `.next` (`Cannot find module './vendor-chunks/*'`, missing manifests). Fix: `rm -rf .next && npm run dev`.

Grab the demo project id for the API tests:

```bash
PID=$(curl -s http://localhost:3000/api/projects | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).projects[0].id))")
echo "Project: $PID"
```

---

## 1. Automated suite (fast smoke)

| #   | Step                | Expected                                                                             |
| --- | ------------------- | ------------------------------------------------------------------------------------ |
| 1.1 | `npm test`          | **47 passing** — includes ee-calcs, review-parse, altiumParser magic-byte tests      |
| 1.2 | `npm run typecheck` | no errors                                                                            |
| 1.3 | `npm run lint`      | no warnings/errors                                                                   |
| 1.4 | `npm run build`     | compiles; routes include `/api/projects/[id]/review` and `/api/projects/[id]/upload` |

**Unit coverage to confirm exists:**

- `src/lib/ee-calcs.test.ts` — reactance (Xc=1/2πfC), parallel R, divider, `4k7`→4700 parsing, range rejection.
- `src/lib/review-parse.test.ts` — drops findings with bad severity/empty title, dedupes/uppercases refdes, handles junk input.
- `src/lib/parsers/altiumParser.test.ts` — OLE2 magic accepted; text + short buffers rejected.

---

## 2. AI Design Review — Reports tab [UI]

| #   | Step                                                          | Expected                                                                                                                                                                                          |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Open **Demo Power Board** → **Reports** tab                   | Stats grid (Files/Components/Nets/BOM/Findings); "AI Design Review" panel with **Run design review** button enabled                                                                               |
| 2.2 | **(no key set)** Click **Run design review**                  | After a moment, a red error banner: _"AI review is not configured: set ANTHROPIC_API_KEY…"_. No crash.                                                                                            |
| 2.3 | **(needs key)** Set key, restart, click **Run design review** | Button shows "Analyzing…"; a loading note appears; within ~30–60s findings render                                                                                                                 |
| 2.4 | Inspect findings                                              | Grouped by functional block; each has a **severity badge** (Possible bug/Verify/Watch/Minor/Cosmetic/OK), optional **HW review** badge, a title, a rationale, and **refdes chips** (e.g. U7, R12) |
| 2.5 | Check grounding                                               | Findings reference real refdes/nets from the board (U7, 5V, GND, R12, C5). Anything about parts not in the data should be **"Verify"**, not stated as fact                                        |
| 2.6 | Reload the page, reopen Reports                               | The last run persists — summary + findings still shown, "Last run …" timestamp present                                                                                                            |
| 2.7 | Click **Re-run review**                                       | New run executes and replaces the displayed findings; a new ReviewRun row is created                                                                                                              |

**Empty-project case:**

| #   | Step                                      | Expected                                                                                |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| 2.8 | Create a new project (no files) → Reports | "Run design review" is **disabled**; hint: _"Upload and parse a netlist or BOM first…"_ |

---

## 3. AI Design Review — API [API]

| #   | Step                                                                          | Expected                                                                                                                                  |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **(no key)** `curl -s -X POST http://localhost:3000/api/projects/$PID/review` | `{"error":"AI review is not configured: set ANTHROPIC_API_KEY…"}`, HTTP 500                                                               |
| 3.2 | **(needs key)** same call                                                     | HTTP 200 JSON: `{ reviewRunId, summary, findings:[…] }`; each finding has `block, severity, title, rationale, refDes[], hwReviewRequired` |
| 3.3 | Bad project id                                                                | `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/projects/nope/review` → **404**                                 |
| 3.4 | **(needs key)** Persistence check                                             | After 3.2, `curl -s http://localhost:3000/api/projects` still 200; reopening the dashboard shows the run (DB-backed)                      |

---

## 4. Altium import — fixtures

These fixtures exercise the _import + validation_ path (we validate the OLE2 header; we do not parse schematic contents). The "valid" fixture is header-only — enough to pass validation.

```bash
# Valid Altium-style binary: starts with the OLE2/CFB magic bytes, padded a bit
printf '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' > /tmp/test.SchDoc
dd if=/dev/zero bs=1024 count=8 >> /tmp/test.SchDoc 2>/dev/null   # ~8 KB

# Invalid: a text file renamed to a PCB extension (should be rejected)
echo "this is plain text, not an Altium binary" > /tmp/bad.PcbDoc

# (Optional) Oversize check: a 51 MB file to trip the 50 MB limit
# mkfile 51m /tmp/huge.SchDoc   # macOS
```

---

## 5. Altium import — UI [UI]

| #   | Step                                            | Expected                                                                                                             |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Demo project → **Files** tab → uploader caption | Lists `.schdoc · .pcbdoc` among accepted types and **max 50 MB**                                                     |
| 5.2 | Drag/browse `/tmp/test.SchDoc`, Upload          | "Uploaded 1 file." Row appears in the files table, category **altium**, status **pending** (stored, awaiting parser) |
| 5.3 | Upload `/tmp/bad.PcbDoc`                        | File still stored, but row shows status **failed** with a clear reason ("Not a recognized Altium binary…")           |
| 5.4 | (Optional) Upload `/tmp/huge.SchDoc` (>50 MB)   | Rejected before storage: per-file error "…exceeds the 50 MB limit"                                                   |
| 5.5 | Upload an unsupported type (e.g. `.zip`)        | Rejected: "Unsupported file type"                                                                                    |

---

## 6. Altium import — API [API]

| #   | Step                                                                                                          | Expected                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 6.1 | Valid binary:<br>`curl -s -X POST http://localhost:3000/api/projects/$PID/upload -F "file=@/tmp/test.SchDoc"` | HTTP 201, `{ success:true, projectFileId, summary:{message:"Altium document imported and stored…"} }` |
| 6.2 | Invalid:<br>`curl -s -X POST http://localhost:3000/api/projects/$PID/upload -F "file=@/tmp/bad.PcbDoc"`       | HTTP 201, `success:false`, summary message about not being a valid Altium binary                      |
| 6.3 | Confirm DB record                                                                                             | The uploaded files appear in the Files tab / `listProjectFiles` with the expected category + status   |

---

## 7. Regression spot-checks

| #   | Step                                     | Expected                                                               |
| --- | ---------------------------------------- | ---------------------------------------------------------------------- |
| 7.1 | Upload `sample-files/sample-netlist.net` | Parses → status **parsed**; Components/Nets/Connectivity tabs populate |
| 7.2 | Upload `sample-files/sample-bom.csv`     | Parses → status **parsed**; BOM tab populates                          |
| 7.3 | Connectivity tab: search `U7` then `5V`  | Returns connected nets / components respectively                       |
| 7.4 | AI Assistant tab (needs key)             | Still answers board questions (unchanged by this work)                 |

---

## 8. Results log

| Section      | Pass/Fail | Notes |
| ------------ | --------- | ----- |
| 1 Automated  |           |       |
| 2 Review UI  |           |       |
| 3 Review API |           |       |
| 5 Altium UI  |           |       |
| 6 Altium API |           |       |
| 7 Regression |           |       |

---

## Cleanup

```bash
rm -f /tmp/test.SchDoc /tmp/bad.PcbDoc /tmp/huge.SchDoc
npm run db:reset    # optional: wipe test uploads/findings, re-seed demo data
```
