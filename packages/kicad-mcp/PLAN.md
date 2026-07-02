# KiCad MCP Server — Implementation Plan

Status: design phase, revised after EE feedback (see "EE feedback" section below). Not yet implemented.

## Repo layout

```
packages/kicad-mcp/
├── pyproject.toml
├── .python-version              # 3.11
├── src/kicad_mcp/
│   ├── __init__.py
│   ├── server.py                # FastMCP instance, registers all tools, main()
│   ├── config.py                # env vars + kicad-cli auto-discovery
│   ├── cli.py                   # kicad-cli subprocess wrapper
│   ├── file_parser.py           # kiutils wrappers — isolated behind clean interface
│   ├── cache.py                 # mtime-keyed in-memory parse cache
│   ├── schema.py                # shared return types (ComponentInfo, NetInfo, etc.)
│   └── tools/
│       ├── __init__.py
│       ├── project.py           # get_project_info
│       ├── components.py        # list_components, get_component
│       ├── nets.py              # list_nets, get_net_connectivity
│       ├── drc.py               # run_drc, run_erc
│       ├── bom.py               # get_bom
│       ├── export.py            # render_board, export_netlist, export_svg
│       ├── hierarchy.py         # get_schematic_hierarchy
│       └── sync.py              # sync_to_resistance
└── tests/
    ├── fixtures/                # sample .kicad_pcb + .kicad_sch for tests
    └── test_tools.py
```

## Dependencies

```toml
[project]
requires-python = ">=3.11"
dependencies = [
    "mcp[cli]>=1.0",
    "kiutils>=1.4",       # latest is 1.4.8, not 1.5
    "httpx>=0.27",
]

[project.scripts]
resistance-kicad-mcp = "kicad_mcp.server:main"
```

No `kicad-skip`. Three deps total. Target KiCad 9.x (latest) only — no multi-version compat layer, no nightly/dev build handling (confirmed not needed, see EE feedback).

## config.py — kicad-cli auto-discovery

`shutil.which("kicad-cli")` returns nothing on macOS (buried in the app bundle) and often on Windows. Auto-discover common install paths before giving up:

Search order:
1. `KICAD_CLI_PATH` env var (explicit override)
2. `shutil.which("kicad-cli")` (Linux, or macOS/Windows if on PATH)
3. `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli` (macOS default)
4. `C:\Program Files\KiCad\9.0\bin\kicad-cli.exe` (Windows default, try 7–11)
5. Raise with clear install instructions

Engineers shouldn't have to set `KICAD_CLI_PATH` manually on a standard install.

## cache.py — mtime-keyed parse cache

Every file-based tool re-parses `.kicad_pcb` / `.kicad_sch` from disk. On a 500-component board, that's seconds per call. Cache keyed on `(path, mtime)` — valid as long as the file hasn't changed:

```
parse_board(path)
  → check cache[(path, mtime)]
  → if hit: return cached Board
  → if miss: kiutils.Board.from_file(path), store, return
```

Retry-with-backoff wrapper around parse calls:
```
→ if parse raises (mid-write race): wait 150ms, retry once
→ if second attempt fails: raise with clear message
```

Cache lives in the MCP server process — wiped when the server restarts, which is fine since it's a local stdio process.

## file_parser.py — kiutils isolated behind a clean interface

Critical architectural rule: nothing outside `file_parser.py` imports `kiutils` directly. All tools call through `file_parser` functions that return `schema.py` dataclasses. When kiutils is eventually replaced (or IPC becomes primary in Phase 2), only this one file changes.

### Hierarchical schematic traversal, with per-instance identity (revised)

Loading the top-level `.kicad_sch` only returns root sheet components. Subsheets (`power.kicad_sch`, `mcu.kicad_sch`, etc.) are separate files, and — confirmed by EE feedback — **the same subsheet file is commonly instantiated at multiple points in the hierarchy** (e.g. two instances of `power.kicad_sch` for dual rails). A flat recursive walk that just concatenates symbol lists will silently merge or misattribute refdes across instances. This is a real requirement, not an edge case.

```
load_all_symbols(root_sch_path, sheet_path=()):
  sch = Schematic.from_file(root_sch_path)
  for symbol in sch.schematicSymbols:
    yield ComponentInfo(..., sheet_path=sheet_path)   # instance-qualified
  for sheet in sch.sheets:
    child_path = root_sch_path.parent / sheet.fileName
    yield from load_all_symbols(child_path, sheet_path + (sheet.uuid,))
```

Each `ComponentInfo` carries a `sheet_path: tuple[str, ...]` (sheet instance UUIDs from root to leaf) so two instances of the same subsheet produce distinct, identifiable components even though they share a source file. KiCad's own hierarchical instance data (per-instance refdes/UUID under the `instances` section of `.kicad_sch`) should be used to resolve the effective refdes per instance rather than assuming refdes is unique per symbol-in-file.

`list_components` must call `load_all_symbols`, not just parse the root sheet. Without this, any hierarchical design returns incomplete data with no error.

### Multi-PCB disambiguation (revised — no silent guessing)

Multiple `.kicad_pcb` files per project directory (test jigs, panelized variants, rev-A/rev-B side by side) were confirmed as a frequent case, not a rare one. Because of that, a "guess by matching `.kicad_pro` basename" default is expected to misfire often (fab-output boards, jig boards, and revision files routinely don't match the project name). Resolution:

1. Glob `*.kicad_pcb` in project dir.
2. If one result → use it.
3. If multiple → do **not** silently guess. Return a clear error listing all candidates and require disambiguation via `KICAD_PCB_FILE` env var or the per-call `pcb_file` parameter.
4. Add a `list_pcb_files` helper (or fold into `get_project_info`) so the assistant can show the candidates and ask the engineer which one, rather than the tool guessing wrong silently.

## schema.py — shared return types (revised)

Every tool returns dataclasses defined here. This is what makes an Altium MCP server possible later — it implements the same schema, different backend.

```python
@dataclass
class ComponentInfo:
    refdes: str
    value: str
    footprint: str
    layer: str
    position: tuple[float, float]
    dnp: bool
    nets: dict[str, str]        # pad_number → net_name
    sheet_path: tuple[str, ...] # sheet instance UUIDs, root → leaf; disambiguates
                                 # repeated subsheet instances
    properties: dict[str, str]

@dataclass
class PinRef:
    refdes: str
    pad_number: str

@dataclass
class NetInfo:
    name: str
    pin_count: int
    pins: list[PinRef]
    net_class: str | None            # confirmed real usage — net classes matter
    diff_pair_partner: str | None    # confirmed real usage — diff pairs matter
                                      # e.g. "USB_DP" ↔ "USB_DM"

@dataclass
class DrcViolation:
    severity: str          # "error" | "warning"
    rule: str
    description: str
    location: tuple[float, float] | None
    layer: str | None

@dataclass
class BomRow:
    refdes: list[str]
    value: str
    footprint: str
    mpn: str | None
    manufacturer: str | None     # added — confirmed used for sourcing
    tolerance: str | None        # added — confirmed used for compliance checks
    voltage_rating: str | None   # added — confirmed used for compliance checks
    current_rating: str | None   # added — confirmed used for compliance checks
    power_rating: str | None     # added — confirmed used for compliance checks
    qty: int
    extra_properties: dict[str, str]  # unrecognized columns pass through here

@dataclass
class ProjectInfo:
    name: str
    kicad_version: str
    pcb_file: str
    schematic_file: str
    last_modified: str
    component_count: int
    net_count: int
    sheet_count: int
```

When Altium MCP is built later, `schema.py` is copied/shared — tool return shapes are identical. A prompt that works on a KiCad board works on an Altium board.

## Tool list

All 12 tools from the original plan, with these properties:

1. `project_dir` is an optional parameter on every tool — overrides `KICAD_PROJECT_DIR` for that call. Engineers can ask about multiple boards in one conversation without restarting.
2. `render_board` caps resolution and is documented as context-expensive:

```python
def render_board(
    side: str = "top",
    layer: str | None = None,
    width: int = 1200,        # capped — no unbounded renders
    project_dir: str | None = None,
) -> str:   # base64 PNG
```

| Tool | Requires kicad-cli | Per-call project_dir | Notes |
|---|---|---|---|
| get_project_info | No | Yes | |
| list_components | No | Yes | Recursive subsheet traversal, instance-qualified |
| get_component | No | Yes | |
| list_nets | No | Yes | Includes net_class, diff_pair_partner |
| get_net_connectivity | No | Yes | |
| get_schematic_hierarchy | No | Yes | Full tree, all subsheets, instance paths |
| get_bom | Yes | Yes | Column-normalized, extended field set |
| run_drc | Yes | Yes | |
| run_erc | Yes | Yes | |
| export_netlist | Yes | Yes | |
| render_board | Yes | Yes | Width capped at 1200px |
| sync_to_resistance | Yes | Yes | Writes mtime to project metadata |

## BOM column normalization (revised field set)

`kicad-cli sch export bom` produces a CSV whose column names depend on each project's BOM configuration. The MCP tool generates this CSV itself via `kicad-cli` regardless of what the engineer manually exports for humans (e.g. a PDF) — the human-facing export format doesn't constrain what the tool can produce internally. The parser normalizes:

| Canonical field | Look for any of these column names (case-insensitive) |
|---|---|
| refdes | "Reference", "Ref", "RefDes", "References" |
| value | "Value", "Val" |
| footprint | "Footprint", "Package" |
| mpn | "MPN", "Manufacturer Part Number", "Part Number", "PN" |
| manufacturer | "Manufacturer", "Mfr", "Mfg" |
| tolerance | "Tolerance", "Tol" |
| voltage_rating | "Voltage", "Voltage Rating", "Rated Voltage" |
| current_rating | "Current", "Current Rating", "Rated Current" |
| power_rating | "Power", "Power Rating", "Wattage" |
| qty | "Quantity", "Qty", "Count" |

These fields are typically populated via custom symbol properties in KiCad rather than stock BOM columns — the normalizer should also check symbol `properties` (from `file_parser`) as a fallback source when the BOM CSV itself doesn't carry them. Unrecognized columns are passed through as-is in `extra_properties`.

## sync_to_resistance — staleness signal

After sync, the Resistance project record needs to know when the data was captured so the assistant can surface it:

```
POST /api/projects/{id}/upload  ← netlist (existing)
POST /api/projects/{id}/upload  ← bom (existing)
PATCH /api/projects/{id}  ← new: { "syncMeta": { "syncedAt": ISO8601, "boardMtime": ISO8601, "kicadVersion": "9.0.1" } }
```

This requires one small Resistance backend addition: a `PATCH /api/projects/[id]` route that accepts a `syncMeta` JSON field stored on the project record. The assistant can then include "last synced 3 hours ago" in its context.

## Packaging — uvx-first

`pip install -e .` requires Python knowledge most EEs don't have. Target `uvx` instead — single command, no venv management, works on macOS/Windows/Linux:

```bash
# Install once
uv tool install /path/to/Resistance/packages/kicad-mcp

# Or run without installing
uvx --from /path/to/Resistance/packages/kicad-mcp resistance-kicad-mcp
```

Claude Desktop config becomes:

```json
{
  "mcpServers": {
    "resistance-kicad": {
      "command": "uvx",
      "args": ["--from", "/path/to/packages/kicad-mcp", "resistance-kicad-mcp"],
      "env": {
        "KICAD_PROJECT_DIR": "/Users/engineer/kicad-projects/my-board"
      }
    }
  }
}
```

Implication for the package: no local path imports. All imports must resolve from installed package. This is already true if the `src/` layout is used correctly.

## Phase 2 IPC — design now, implement later

KiCad 11 removes SWIG bindings. The clean interface in `file_parser.py` means swapping backends is scoped to one file. The Phase 2 design:

```
file_parser.py stays as the interface
    ├── _backend_kiutils.py   (current — parses files)
    └── _backend_ipc.py       (Phase 2 — talks to kicad-python IPC socket)

On startup:
    if IPC socket found → use _backend_ipc (live, richer)
    else               → use _backend_kiutils (file-based, always works)
```

Both backends return the same `schema.py` dataclasses. Tools are unaware which backend is active.

## Build order

1. `pyproject.toml` scaffold + `schema.py` — define return types first, everything else builds toward them
2. `config.py` — env vars + kicad-cli auto-discovery (macOS/Windows paths)
3. `cache.py` — mtime cache + retry wrapper
4. `file_parser.py` — kiutils behind the clean interface, with recursive subsheet traversal and per-instance sheet_path
5. `cli.py` — kicad-cli subprocess wrapper
6. All 6 file-based tools — testable immediately, grab a KiCad example project with a reused subsheet for fixtures
7. `get_bom` with column normalization + symbol-property fallback for manufacturer/tolerance/voltage/current/power
8. `run_drc`, `run_erc`, `export_netlist`, `render_board` — need kicad-cli installed
9. `sync_to_resistance` — needs kicad-cli + small Resistance PATCH endpoint addition
10. `server.py` — wires all tools, validates config at startup
11. `tests/test_tools.py` — smoke tests against fixture project, including a multi-PCB and reused-subsheet fixture

One Resistance backend change required: `PATCH /api/projects/[id]` for sync metadata. Everything else uses existing endpoints.

## EE feedback

Answers from the EE partner who'd actually use this, and what they changed in the plan above:

| # | Question | Answer | Impact |
|---|---|---|---|
| 1 | KiCad version floor | Latest version only | No multi-version compat layer needed |
| 2 | Nightly/dev builds | No | CLI output format assumed stable |
| 3 | Same subsheet reused at multiple hierarchy points | Very common | **Schema change** — added `sheet_path` to `ComponentInfo`, instance-qualified traversal |
| 4 | Multiple `.kicad_pcb` files per project | Very often | **Scope change** — dropped silent basename-matching guess in favor of explicit disambiguation |
| 5 | Day-to-day BOM export format | Exported to PDF | No change — MCP generates its own CSV via kicad-cli regardless of human-facing export |
| 6 | BOM fields beyond MPN | Manufacturer, tolerance, voltage range, current rating, power rating | **Schema change** — added 5 canonical fields to `BomRow` |
| 7 | Which DRC/ERC violations are acted on vs. noise | Not yet answered | Open |
| 8 | Custom `.kicad_dru` rules vs. stock | Not yet answered | Open |
| 9 | Net classes / diff pairs / power-ground flagging | Rely on net names, classes, differential pairs | **Schema change** — added `net_class`, `diff_pair_partner` to `NetInfo` |
| 10 | Component values normalized to numeric units | Not yet answered | Open |
| 11 | Footprint/symbol library location | Local footprints | No change — confirms simple project-relative path resolution, no external library resolution needed |
| 12 | Default render view | Not yet answered | Open — `render_board` still defaults to `side="top"`, unconfirmed |
| 13 | Expected re-sync frequency | Not yet answered | Open — affects whether "synced N hours ago" is a useful staleness signal |

Open items (7, 8, 10, 12, 13) don't currently block starting implementation — none forces a schema change the way 3, 4, 6, and 9 did — but worth closing before `run_drc`/`run_erc` (7, 8) and `render_board` (12) are built.
