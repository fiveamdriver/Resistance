# resistance-kicad-mcp

MCP server exposing KiCad projects (schematics, boards, BOM, DRC/ERC, renders)
to AI assistants, with a `sync_to_resistance` tool that pushes netlist + BOM
into the Resistance app.

Targets KiCad 10.x. Reads `.kicad_sch` / `.kicad_pcb` files directly (KiCad
does not need to be running); DRC/ERC/netlist/render tools shell out to
`kicad-cli`, which is auto-discovered on macOS/Windows/Linux.

## Install

Requires [uv](https://docs.astral.sh/uv/) (`brew install uv`). No Python or
venv setup needed — `uvx` re-resolves from this directory on every launch, so
`git pull` updates take effect immediately.

Claude Desktop / Claude Code MCP config:

```json
{
  "mcpServers": {
    "resistance-kicad": {
      "command": "uvx",
      "args": ["--from", "/path/to/resistance/packages/kicad-mcp", "resistance-kicad-mcp"],
      "env": {
        "KICAD_PROJECT_DIR": "/Users/engineer/kicad-projects/my-board"
      }
    }
  }
}
```

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `KICAD_PROJECT_DIR` | Default project directory (every tool also takes a per-call `project_dir`) | — |
| `KICAD_PCB_FILE` | Board file when the project dir has several `.kicad_pcb` (jigs, revisions) | error listing candidates |
| `KICAD_CLI_PATH` | Explicit kicad-cli path | auto-discovered |
| `RESISTANCE_API_URL` | Resistance app base URL for sync | `http://localhost:3000` |
| `RESISTANCE_API_TOKEN` | Reserved for when Resistance grows auth | unset |

## Tools

`get_project_info`, `list_pcb_files`, `list_components`, `get_component`,
`list_nets`, `get_net_connectivity`, `get_schematic_hierarchy`, `get_bom`,
`run_drc`, `run_erc`, `export_netlist`, `render_board`, `sync_to_resistance`.

Hierarchical designs are fully expanded: a subsheet instantiated at multiple
points yields one component per instance with its own refdes and
`sheet_path`. Board/schematic mismatches (stale refdes after re-annotation)
are surfaced as warnings, never silently merged.

## Development

```bash
uv sync
uv run pytest
```

Tests run against fixtures in `tests/fixtures/` (KiCad-9/10-format files,
validated with kicad-cli itself). kicad-cli-backed tests skip automatically
when KiCad isn't installed.
