"""DRC / ERC via kicad-cli, normalized to DrcViolation."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from .. import cli
from ..schema import DrcViolation


def _violations_from_report(report: dict) -> list[DrcViolation]:
    out: list[DrcViolation] = []
    # pcb drc: violations / unconnected_items / schematic_parity
    # sch erc:  sheets[].violations
    buckets: list[dict] = []
    for key in ("violations", "unconnected_items", "schematic_parity"):
        buckets.extend(report.get(key) or [])
    for sheet in report.get("sheets") or []:
        buckets.extend(sheet.get("violations") or [])

    for v in buckets:
        items = v.get("items") or []
        pos = items[0].get("pos") if items else None
        location = (pos["x"], pos["y"]) if pos else None
        # kicad-cli reports coordinates in the requested units (we pass mm);
        # layer is not part of the JSON report, so it stays None.
        out.append(
            DrcViolation(
                severity=v.get("severity", "error"),
                rule=v.get("type", "unknown"),
                description=v.get("description", ""),
                location=location,
                layer=None,
            )
        )
    return out


def run_drc(pcb_path: Path) -> list[DrcViolation]:
    with tempfile.TemporaryDirectory() as tmp:
        report_path = Path(tmp) / "drc.json"
        cli.run(
            ["pcb", "drc", "--format", "json", "--severity-all", "--units", "mm",
             "--output", str(report_path), str(pcb_path)]
        )
        report = json.loads(report_path.read_text())
    return _violations_from_report(report)


def run_erc(sch_path: Path) -> list[DrcViolation]:
    with tempfile.TemporaryDirectory() as tmp:
        report_path = Path(tmp) / "erc.json"
        cli.run(
            ["sch", "erc", "--format", "json", "--severity-all", "--units", "mm",
             "--output", str(report_path), str(sch_path)]
        )
        report = json.loads(report_path.read_text())
    return _violations_from_report(report)
