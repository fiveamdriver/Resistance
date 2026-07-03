"""Netlist export and board rendering via kicad-cli."""

from __future__ import annotations

import tempfile
from pathlib import Path

from .. import cli

MAX_RENDER_WIDTH = 1200  # capped — no unbounded renders; images are context-expensive

_RENDER_SIDES = {"top", "bottom", "left", "right", "front", "back"}


def export_netlist(sch_path: Path, fmt: str = "kicadsexpr") -> str:
    """The kicadsexpr default is the .net format Resistance's parser ingests."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "netlist.net"
        cli.run(
            ["sch", "export", "netlist", "--format", fmt, "--output", str(out),
             str(sch_path)]
        )
        return out.read_text()


def render_board(
    pcb_path: Path, side: str = "top", layer: str | None = None, width: int = 1200
) -> tuple[bytes, str]:
    """Returns (image bytes, format). 3D raytrace render for side views; a
    single-layer request switches to a 2D SVG export instead."""
    width = max(100, min(width, MAX_RENDER_WIDTH))

    with tempfile.TemporaryDirectory() as tmp:
        if layer:
            out = Path(tmp) / "layer.svg"
            cli.run(
                ["pcb", "export", "svg", "--layers", f"{layer},Edge.Cuts",
                 "--page-size-mode", "2", "--exclude-drawing-sheet",
                 "--output", str(out), str(pcb_path)]
            )
            return out.read_bytes(), "svg"

        if side not in _RENDER_SIDES:
            raise ValueError(f"side must be one of {sorted(_RENDER_SIDES)}")
        out = Path(tmp) / "board.png"
        cli.run(
            ["pcb", "render", "--side", side, "--width", str(width),
             "--height", str(int(width * 0.75)), "--output", str(out), str(pcb_path)]
        )
        return out.read_bytes(), "png"
