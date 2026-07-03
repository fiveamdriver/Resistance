"""kiutils isolated behind a clean interface.

Critical architectural rule: nothing outside this module imports kiutils.
All tools call through these functions, which return schema.py dataclasses.
When the backend is swapped (raw s-expressions, or the Phase 2 IPC API),
only this file changes.
"""

from __future__ import annotations

import fnmatch
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from kiutils.board import Board
from kiutils.schematic import Schematic

from . import cache, config
from .schema import ComponentInfo, NetInfo, PinRef, ProjectInfo, SheetNode

# ── raw file access (cached) ────────────────────────────────────────────────


def load_board(path: str | Path) -> Board:
    return cache.get_or_parse(path, Board.from_file)


def load_schematic(path: str | Path) -> Schematic:
    return cache.get_or_parse(path, Schematic.from_file)


def read_generator_version(path: str | Path) -> str:
    """From the file header — the KiCad version that last saved the file.
    Read directly (kiutils 1.4.8 predates the generator_version token)."""
    head = Path(path).read_text(encoding="utf-8", errors="replace")[:500]
    m = re.search(r'generator_version\s+"([^"]+)"', head)
    return m.group(1) if m else "unknown"


# ── schematic traversal ─────────────────────────────────────────────────────


@dataclass
class SymbolInstance:
    """One symbol at one point in the expanded hierarchy (internal)."""

    refdes: str
    value: str
    footprint: str
    dnp: bool
    in_bom: bool
    uuid: str
    sheet_path: tuple[str, ...]  # sheet instance UUIDs, root → leaf
    instance_path: str  # "/<root_uuid>[/<sheet_uuid>...]" as KiCad writes it
    properties: dict[str, str]


def _props(symbol) -> dict[str, str]:
    return {p.key: p.value for p in symbol.properties}


def _instance_refdes(symbol, instance_path: str) -> str | None:
    """Per-instance refdes from the symbol's `instances` block. A subsheet
    used twice stores a distinct reference for each instance path."""
    for project in symbol.instances or []:
        for p in project.paths:
            if p.sheetInstancePath == instance_path:
                return p.reference
    return None


def load_all_symbols(root_sch_path: Path) -> list[SymbolInstance]:
    """Expand the full hierarchy. The same subsheet file instantiated at
    multiple points yields one SymbolInstance per instance, each with the
    refdes KiCad assigned to that instance."""
    root = load_schematic(root_sch_path)
    root_uuid = root.uuid
    out: list[SymbolInstance] = []
    seen_files: list[str] = []  # cycle guard, per traversal branch

    def walk(sch, sch_path: Path, sheet_uuids: tuple[str, ...], instance_path: str):
        for symbol in sch.schematicSymbols:
            props = _props(symbol)
            refdes = _instance_refdes(symbol, instance_path) or props.get("Reference", "?")
            if refdes.startswith("#"):  # power symbols, PWR_FLAG — not components
                continue
            out.append(
                SymbolInstance(
                    refdes=refdes,
                    value=props.get("Value", ""),
                    footprint=props.get("Footprint", ""),
                    dnp=bool(getattr(symbol, "dnp", False)),
                    in_bom=bool(getattr(symbol, "inBom", True)),
                    uuid=str(symbol.uuid),
                    sheet_path=sheet_uuids,
                    instance_path=instance_path,
                    properties=props,
                )
            )
        for sheet in sch.sheets:
            file_name = _sheet_value(sheet.fileName)
            child = (sch_path.parent / file_name).resolve()
            if not child.is_file():
                continue  # missing subsheet: skip rather than fail the whole walk
            branch_key = f"{child}@{sheet.uuid}"
            if branch_key in seen_files:
                continue
            seen_files.append(branch_key)
            sheet_uuid = str(sheet.uuid)
            walk(
                load_schematic(child),
                child,
                sheet_uuids + (sheet_uuid,),
                f"{instance_path}/{sheet_uuid}",
            )

    walk(root, Path(root_sch_path), (), f"/{root_uuid}")

    # Multi-unit symbols (e.g. op-amp A/B halves) appear once per unit with
    # the same refdes+instance; components are per-refdes, so deduplicate.
    deduped: dict[tuple[str, str], SymbolInstance] = {}
    for s in out:
        deduped.setdefault((s.instance_path, s.refdes), s)
    return list(deduped.values())


def _sheet_value(prop) -> str:
    return getattr(prop, "value", None) or str(prop)


def get_hierarchy(root_sch_path: Path) -> SheetNode:
    root = load_schematic(root_sch_path)

    def count_symbols(sch) -> int:
        return sum(
            1
            for s in sch.schematicSymbols
            if not _props(s).get("Reference", "").startswith("#")
        )

    def walk(sch, sch_path: Path, name: str, uuids: tuple[str, ...]) -> SheetNode:
        node = SheetNode(
            name=name,
            file=sch_path.name,
            instance_path=uuids,
            symbol_count=count_symbols(sch),
        )
        for sheet in sch.sheets:
            file_name = _sheet_value(sheet.fileName)
            child = (sch_path.parent / file_name).resolve()
            if not child.is_file():
                continue
            node.children.append(
                walk(
                    load_schematic(child),
                    child,
                    _sheet_value(sheet.sheetName),
                    uuids + (str(sheet.uuid),),
                )
            )
        return node

    return walk(root, Path(root_sch_path), Path(root_sch_path).stem, ())


# ── board extraction ────────────────────────────────────────────────────────


@dataclass
class FootprintOnBoard:
    """One placed footprint (internal)."""

    refdes: str
    value: str
    footprint: str
    layer: str
    position: tuple[float, float]
    path_segments: tuple[str, ...]  # from the fp `path` attr: sheet uuids + symbol uuid
    board_only: bool
    pad_nets: dict[str, str]
    properties: dict[str, str]


def load_footprints(pcb_path: Path) -> list[FootprintOnBoard]:
    board = load_board(pcb_path)
    out = []
    for fp in board.footprints:
        props = dict(fp.properties) if isinstance(fp.properties, dict) else {}
        segments = tuple(s for s in (fp.path or "").split("/") if s)
        attrs = fp.attributes
        pad_nets = {
            str(pad.number): pad.net.name for pad in fp.pads if pad.net is not None
        }
        out.append(
            FootprintOnBoard(
                refdes=props.get("Reference", ""),
                value=props.get("Value", ""),
                footprint=f"{fp.libraryNickname}:{fp.entryName}"
                if fp.libraryNickname
                else fp.entryName,
                layer=fp.layer,
                position=(fp.position.X, fp.position.Y),
                path_segments=segments,
                board_only=bool(attrs and getattr(attrs, "boardOnly", False)),
                pad_nets=pad_nets,
                properties={k: v for k, v in props.items() if not k.startswith("ki_")},
            )
        )
    return out


# ── schematic ↔ board join ──────────────────────────────────────────────────


def get_components(
    root_sch_path: Path | None, pcb_path: Path | None
) -> list[ComponentInfo]:
    """Join key is the refdes (designators match on an annotated, synced
    project). The footprint `path` attribute (sheet uuids + symbol uuid) is
    cross-checked against the schematic instance to detect out-of-sync boards
    — warn, never silently return mismatched data."""
    symbols = load_all_symbols(root_sch_path) if root_sch_path else []
    footprints = load_footprints(pcb_path) if pcb_path else []

    fp_by_refdes = {fp.refdes: fp for fp in footprints if fp.refdes}
    out: list[ComponentInfo] = []
    matched: set[str] = set()

    for sym in symbols:
        fp = fp_by_refdes.get(sym.refdes)
        warnings: list[str] = []
        if sym.refdes.startswith("?") or sym.refdes.endswith("?"):
            warnings.append("unannotated symbol — cannot join to board")
            fp = None
        if fp is not None:
            matched.add(sym.refdes)
            expected = sym.sheet_path + (sym.uuid,)
            if fp.path_segments and fp.path_segments != expected:
                warnings.append(
                    "board footprint path does not match this schematic instance — "
                    "board may be out of sync (run Update PCB from Schematic)"
                )
        out.append(
            ComponentInfo(
                refdes=sym.refdes,
                value=sym.value,
                footprint=sym.footprint or (fp.footprint if fp else ""),
                on_board=fp is not None,
                layer=fp.layer if fp else None,
                position=fp.position if fp else None,
                dnp=sym.dnp,
                nets=fp.pad_nets if fp else {},
                sheet_path=sym.sheet_path,
                properties=sym.properties,
                warnings=warnings,
            )
        )

    # Board-only footprints: mounting holes, fiducials, logos — expected, not errors.
    for fp in footprints:
        if fp.refdes in matched:
            continue
        out.append(
            ComponentInfo(
                refdes=fp.refdes or "(unnamed)",
                value=fp.value,
                footprint=fp.footprint,
                on_board=True,
                layer=fp.layer,
                position=fp.position,
                dnp=False,
                nets=fp.pad_nets,
                sheet_path=(),
                properties=fp.properties,
                warnings=[] if fp.board_only or not root_sch_path else [
                    "footprint has no matching schematic symbol"
                ],
            )
        )
    return out


# ── nets ────────────────────────────────────────────────────────────────────

_DIFF_SUFFIXES = [("+", "-"), ("_P", "_N"), ("P", "N")]


def _diff_pair_partner(name: str, all_nets: set[str]) -> str | None:
    """KiCad derives diff pairs from naming conventions (+/-, _P/_N, P/N);
    nothing is stored. Replicate the suffix rules; a partner only counts if
    that net actually exists."""
    for a, b in _DIFF_SUFFIXES:
        for suffix, other in ((a, b), (b, a)):
            if name.endswith(suffix) and len(name) > len(suffix):
                candidate = name[: -len(suffix)] + other
                if candidate in all_nets:
                    return candidate
    return None


def _net_class_resolver(project_file: Path | None):
    """From .kicad_pro net_settings: explicit assignments first, then wildcard
    patterns, else Default. (Phase 1: fnmatch patterns only.)"""
    assignments: dict[str, str] = {}
    patterns: list[tuple[str, str]] = []
    if project_file and project_file.is_file():
        try:
            ns = json.loads(project_file.read_text()).get("net_settings", {})
        except (json.JSONDecodeError, OSError):
            ns = {}
        raw_assign = ns.get("netclass_assignments") or {}
        for net, cls in raw_assign.items():
            assignments[net] = cls[0] if isinstance(cls, list) and cls else str(cls)
        for entry in ns.get("netclass_patterns") or []:
            if isinstance(entry, dict) and entry.get("pattern"):
                patterns.append((entry["pattern"], entry.get("netclass", "Default")))

    def resolve(net_name: str) -> str:
        if net_name in assignments:
            return assignments[net_name]
        for pattern, cls in patterns:
            if fnmatch.fnmatch(net_name, pattern):
                return cls
        return "Default"

    return resolve


def get_nets(pcb_path: Path, project_file: Path | None) -> list[NetInfo]:
    footprints = load_footprints(pcb_path)
    pins_by_net: dict[str, list[PinRef]] = {}
    for fp in footprints:
        for pad, net in fp.pad_nets.items():
            if net:
                pins_by_net.setdefault(net, []).append(PinRef(fp.refdes, pad))

    board = load_board(pcb_path)
    names = {n.name for n in board.nets if n.name} | set(pins_by_net)
    resolve_class = _net_class_resolver(project_file)
    return [
        NetInfo(
            name=name,
            pin_count=len(pins_by_net.get(name, [])),
            pins=sorted(pins_by_net.get(name, []), key=lambda p: (p.refdes, p.pad_number)),
            net_class=resolve_class(name),
            diff_pair_partner=_diff_pair_partner(name, names),
        )
        for name in sorted(names)
    ]


# ── project info ────────────────────────────────────────────────────────────


def get_project_info(project_dir: Path, pcb_file: str | None = None) -> ProjectInfo:
    pro = config.resolve_project_file(project_dir)

    pcb_path: Path | None = None
    try:
        pcb_path = config.resolve_pcb_file(project_dir, pcb_file)
    except config.ConfigError:
        pass  # multiple or zero boards — report what we can; components need it

    sch_path: Path | None = None
    try:
        sch_path = config.resolve_root_schematic(project_dir)
    except config.ConfigError:
        pass

    name = pro.stem if pro else (pcb_path.stem if pcb_path else project_dir.name)
    version_source = pcb_path or sch_path
    files = [p for p in (pcb_path, sch_path, pro) if p]
    last_modified = max((f.stat().st_mtime for f in files), default=0)

    component_count = net_count = sheet_count = 0
    if sch_path:
        symbols = load_all_symbols(sch_path)
        component_count = len(symbols)
        hierarchy = get_hierarchy(sch_path)

        def count(node: SheetNode) -> int:
            return 1 + sum(count(c) for c in node.children)

        sheet_count = count(hierarchy)
    if pcb_path:
        board = load_board(pcb_path)
        net_count = sum(1 for n in board.nets if n.name)
        if not sch_path:
            component_count = len(board.footprints)

    return ProjectInfo(
        name=name,
        kicad_version=read_generator_version(version_source) if version_source else "unknown",
        pcb_file=pcb_path.name if pcb_path else None,
        schematic_file=sch_path.name if sch_path else None,
        last_modified=datetime.fromtimestamp(last_modified, tz=timezone.utc).isoformat()
        if last_modified
        else "",
        component_count=component_count,
        net_count=net_count,
        sheet_count=sheet_count,
    )
