"""Shared return types for all tools.

Every tool returns (lists of) these dataclasses, serialized to JSON by the MCP
layer. A future Altium MCP server implements the same shapes with a different
backend, so nothing KiCad-specific beyond `sheet_path` semantics may leak in.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class ComponentInfo:
    refdes: str
    value: str
    footprint: str
    on_board: bool  # False: schematic-only (no footprint placed on the PCB)
    layer: str | None  # None when not on board
    position: tuple[float, float] | None  # None when not on board
    dnp: bool
    nets: dict[str, str]  # pad_number → net_name; empty when not on board
    # Sheet instance UUIDs, root → leaf; disambiguates repeated subsheet
    # instances. () for board-only footprints (mounting holes, fiducials).
    # Cross-checked against the footprint's `path` attribute to detect
    # out-of-sync boards.
    sheet_path: tuple[str, ...]
    properties: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass
class PinRef:
    refdes: str
    pad_number: str


@dataclass
class NetInfo:
    name: str
    pin_count: int
    pins: list[PinRef]
    net_class: str | None  # from .kicad_pro net_settings (explicit + patterns)
    diff_pair_partner: str | None  # derived from net-name conventions, not stored


@dataclass
class DrcViolation:
    severity: str  # "error" | "warning"
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
    manufacturer: str | None
    tolerance: str | None
    voltage_rating: str | None
    current_rating: str | None
    power_rating: str | None
    # Stock KiCad "Datasheet" field, http(s) URLs only ("~" and local paths
    # dropped). Resistance ingests the linked PDF as a tier-2 datasheet.
    datasheet: str | None
    qty: int
    extra_properties: dict[str, str] = field(default_factory=dict)


@dataclass
class SheetNode:
    name: str
    file: str
    instance_path: tuple[str, ...]  # sheet instance UUIDs, root → this node
    symbol_count: int
    children: list["SheetNode"] = field(default_factory=list)


@dataclass
class ProjectInfo:
    name: str
    # From the file's generator_version header — the KiCad version that last
    # saved the file, not the installed KiCad.
    kicad_version: str
    pcb_file: str | None
    schematic_file: str | None
    last_modified: str
    component_count: int
    net_count: int
    sheet_count: int


def to_dict(obj: Any) -> Any:
    """Serialize a schema dataclass (or list of them) for the MCP layer."""
    if isinstance(obj, list):
        return [to_dict(o) for o in obj]
    return asdict(obj)
