"""Push netlist + BOM to Resistance and stamp sync metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import httpx

from .. import config, file_parser
from . import bom as bom_tool
from . import export


def sync_to_resistance(
    project_id: str,
    root_sch_path: Path,
    pcb_path: Path | None,
) -> dict:
    base = config.resistance_api_url()
    headers = {}
    token = config.resistance_api_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    netlist = export.export_netlist(root_sch_path)
    bom_csv = bom_tool.bom_to_csv(bom_tool.get_bom(root_sch_path))
    stem = root_sch_path.stem

    results = {}
    with httpx.Client(base_url=base, headers=headers, timeout=60) as client:
        for filename, content, kind in (
            (f"{stem}.net", netlist, "netlist"),
            (f"{stem}-bom.csv", bom_csv, "bom"),
        ):
            resp = client.post(
                f"/api/projects/{project_id}/upload",
                files={"file": (filename, content.encode(), "application/octet-stream")},
                data={"provenance": "kicad_sync"},
            )
            resp.raise_for_status()
            results[kind] = resp.json()

        sync_meta = {
            "syncedAt": datetime.now(timezone.utc).isoformat(),
            "boardMtime": datetime.fromtimestamp(
                (pcb_path or root_sch_path).stat().st_mtime, tz=timezone.utc
            ).isoformat(),
            "kicadVersion": file_parser.read_generator_version(pcb_path or root_sch_path),
            "kicadProjectDir": str(root_sch_path.parent),
        }
        resp = client.patch(
            f"/api/projects/{project_id}", json={"syncMeta": sync_meta}
        )
        resp.raise_for_status()
        results["syncMeta"] = sync_meta

    return results
