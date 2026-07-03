"""FastMCP server exposing KiCad projects to AI assistants.

Every tool takes an optional project_dir that overrides KICAD_PROJECT_DIR for
that call, so engineers can ask about multiple boards in one conversation.
"""

from __future__ import annotations

from pathlib import Path

from mcp.server.fastmcp import FastMCP, Image

from . import config, file_parser
from .schema import to_dict
from .tools import bom as bom_tool
from .tools import drc as drc_tool
from .tools import export as export_tool
from .tools import sync as sync_tool

mcp = FastMCP("resistance-kicad")


def _project(project_dir: str | None) -> Path:
    return config.resolve_project_dir(project_dir)


def _sch(project_dir: str | None) -> Path:
    return config.resolve_root_schematic(_project(project_dir))


def _pcb(project_dir: str | None, pcb_file: str | None) -> Path:
    return config.resolve_pcb_file(_project(project_dir), pcb_file)


# ── project ─────────────────────────────────────────────────────────────────


@mcp.tool()
def get_project_info(project_dir: str | None = None, pcb_file: str | None = None) -> dict:
    """Overview of a KiCad project: name, KiCad version, file names, component /
    net / sheet counts. Start here when a conversation turns to a board."""
    return to_dict(file_parser.get_project_info(_project(project_dir), pcb_file))


@mcp.tool()
def list_pcb_files(project_dir: str | None = None) -> list[str]:
    """List all .kicad_pcb files in the project directory. Multiple boards per
    directory (test jigs, panelized variants, revisions) are common — when other
    tools report ambiguity, show these candidates and ask the engineer which
    one, then pass it as pcb_file."""
    return [p.name for p in config.list_pcb_files(_project(project_dir))]


# ── components ──────────────────────────────────────────────────────────────


@mcp.tool()
def list_components(
    project_dir: str | None = None, pcb_file: str | None = None
) -> list[dict]:
    """All components with refdes, value, footprint, board placement, pad→net
    map, and sheet_path (hierarchical designs are fully expanded — a subsheet
    used twice yields both instances). Schematic-only parts have on_board=false;
    board-only footprints (fiducials, mounting holes) have an empty sheet_path."""
    project = _project(project_dir)
    sch = config.resolve_root_schematic(project)
    try:
        pcb = config.resolve_pcb_file(project, pcb_file)
    except config.ConfigError:
        pcb = None  # schematic-only answers still work; board fields stay null
    return to_dict(file_parser.get_components(sch, pcb))


@mcp.tool()
def get_component(
    refdes: str, project_dir: str | None = None, pcb_file: str | None = None
) -> dict | list[dict]:
    """One component by refdes (e.g. "C1"), with all symbol properties. Returns
    a list when the refdes appears in multiple sheet instances."""
    matches = [
        c
        for c in list_components(project_dir, pcb_file)
        if c["refdes"].lower() == refdes.lower()
    ]
    if not matches:
        raise ValueError(f"No component {refdes!r} in this project.")
    return matches[0] if len(matches) == 1 else matches


# ── nets ────────────────────────────────────────────────────────────────────


@mcp.tool()
def list_nets(project_dir: str | None = None, pcb_file: str | None = None) -> list[dict]:
    """All nets with pin counts, net class (from the project's net_settings),
    and derived diff-pair partner (from KiCad naming conventions: +/-, _P/_N, P/N)."""
    project = _project(project_dir)
    pcb = config.resolve_pcb_file(project, pcb_file)
    return to_dict(file_parser.get_nets(pcb, config.resolve_project_file(project)))


@mcp.tool()
def get_net_connectivity(
    net_name: str, project_dir: str | None = None, pcb_file: str | None = None
) -> dict:
    """Every pin (refdes + pad) on one net, exact name match."""
    for net in list_nets(project_dir, pcb_file):
        if net["name"] == net_name:
            return net
    raise ValueError(f"No net named {net_name!r}. Use list_nets to see all names.")


# ── hierarchy ───────────────────────────────────────────────────────────────


@mcp.tool()
def get_schematic_hierarchy(project_dir: str | None = None) -> dict:
    """Full sheet tree with per-instance paths and symbol counts. A subsheet
    file reused at multiple points appears once per instance."""
    return to_dict(file_parser.get_hierarchy(_sch(project_dir)))


# ── kicad-cli backed tools ──────────────────────────────────────────────────


@mcp.tool()
def get_bom(project_dir: str | None = None, include_dnp: bool = False) -> list[dict]:
    """Bill of materials grouped by value/footprint/MPN. Property names are
    normalized (MPN#, Mfr, Rated Voltage, … land in canonical fields);
    unrecognized properties pass through in extra_properties."""
    return to_dict(bom_tool.get_bom(_sch(project_dir), include_dnp))


@mcp.tool()
def run_drc(project_dir: str | None = None, pcb_file: str | None = None) -> list[dict]:
    """Run design rule check on the board via kicad-cli. Returns violations
    with severity, rule id, description, and mm coordinates."""
    return to_dict(drc_tool.run_drc(_pcb(project_dir, pcb_file)))


@mcp.tool()
def run_erc(project_dir: str | None = None) -> list[dict]:
    """Run electrical rule check on the schematic via kicad-cli."""
    return to_dict(drc_tool.run_erc(_sch(project_dir)))


@mcp.tool()
def export_netlist(project_dir: str | None = None, format: str = "kicadsexpr") -> str:
    """Export the schematic netlist (kicadsexpr | kicadxml | orcadpcb2 | spice)."""
    return export_tool.export_netlist(_sch(project_dir), format)


@mcp.tool()
def render_board(
    side: str = "top",
    layer: str | None = None,
    width: int = 1200,
    project_dir: str | None = None,
    pcb_file: str | None = None,
) -> Image:
    """Render the board. side: top|bottom|left|right|front|back (3D raytrace
    PNG). Pass layer (e.g. "F.Cu") for a 2D single-layer SVG instead. Width is
    capped at 1200px — renders are context-expensive, request sparingly."""
    data, fmt = export_tool.render_board(_pcb(project_dir, pcb_file), side, layer, width)
    return Image(data=data, format=fmt)


@mcp.tool()
def sync_to_resistance(project_id: str, project_dir: str | None = None) -> dict:
    """Push this project's netlist and BOM to the Resistance app (project id
    from the Resistance UI) and stamp sync metadata so staleness is visible."""
    project = _project(project_dir)
    sch = config.resolve_root_schematic(project)
    try:
        pcb = config.resolve_pcb_file(project)
    except config.ConfigError:
        pcb = None
    return sync_tool.sync_to_resistance(project_id, sch, pcb)


def main() -> None:
    # Fail fast on misconfiguration that would break every file-based tool;
    # kicad-cli is only required by the tools that shell out to it.
    mcp.run()


if __name__ == "__main__":
    main()
