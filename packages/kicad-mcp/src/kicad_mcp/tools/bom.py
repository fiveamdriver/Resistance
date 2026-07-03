"""BOM generation with column/property-name normalization.

Primary source is the parsed schematic (per-instance symbols from
file_parser), not a kicad-cli CSV: we already hold every symbol property, and
property names vary per project — normalization is the same either way, but
this path needs no kicad-cli and can't disagree with list_components.
"""

from __future__ import annotations

import re
from pathlib import Path

from ..file_parser import SymbolInstance, load_all_symbols
from ..schema import BomRow

# canonical field → accepted property/column names. Matching is fuzzy: names
# are lowercased and stripped of non-alphanumerics, so "MPN#", "Mfr. Part No"
# style variants still land.
_ALIASES: dict[str, list[str]] = {
    "mpn": ["mpn", "manufacturerpartnumber", "partnumber", "pn", "mfrpartno"],
    "manufacturer": ["manufacturer", "mfr", "mfg", "maker"],
    "tolerance": ["tolerance", "tol"],
    "voltage_rating": ["voltage", "voltagerating", "ratedvoltage", "vrating"],
    "current_rating": ["current", "currentrating", "ratedcurrent", "irating"],
    "power_rating": ["power", "powerrating", "wattage", "prating"],
}

_STOCK_KEYS = {"reference", "value", "footprint", "datasheet", "description"}


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _extract_fields(properties: dict[str, str]) -> tuple[dict[str, str | None], dict[str, str]]:
    """Split symbol properties into canonical BOM fields and pass-through extras."""
    by_norm = {_norm(k): (k, v) for k, v in properties.items() if v and v != "~"}
    canonical: dict[str, str | None] = {}
    used: set[str] = set()
    for field, aliases in _ALIASES.items():
        canonical[field] = None
        for alias in aliases:
            if alias in by_norm:
                canonical[field] = by_norm[alias][1]
                used.add(by_norm[alias][0])
                break
    extras = {
        k: v
        for k, v in properties.items()
        if v and v != "~" and k not in used and _norm(k) not in _STOCK_KEYS
    }
    return canonical, extras


def get_bom(root_sch_path: Path, include_dnp: bool = False) -> list[BomRow]:
    symbols = load_all_symbols(root_sch_path)
    groups: dict[tuple, list[SymbolInstance]] = {}
    for sym in symbols:
        if not sym.in_bom:
            continue
        if sym.dnp and not include_dnp:
            continue
        canonical, _ = _extract_fields(sym.properties)
        key = (sym.value, sym.footprint, canonical["mpn"])
        groups.setdefault(key, []).append(sym)

    rows: list[BomRow] = []
    for (value, footprint, _mpn), members in groups.items():
        canonical, extras = _extract_fields(members[0].properties)
        rows.append(
            BomRow(
                refdes=sorted(m.refdes for m in members),
                value=value,
                footprint=footprint,
                mpn=canonical["mpn"],
                manufacturer=canonical["manufacturer"],
                tolerance=canonical["tolerance"],
                voltage_rating=canonical["voltage_rating"],
                current_rating=canonical["current_rating"],
                power_rating=canonical["power_rating"],
                qty=len(members),
                extra_properties=extras,
            )
        )
    rows.sort(key=lambda r: r.refdes[0])
    return rows


def bom_to_csv(rows: list[BomRow]) -> str:
    """CSV for Resistance's BOM upload pipeline."""
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["Reference", "Value", "Footprint", "MPN", "Manufacturer", "Tolerance",
         "Voltage Rating", "Current Rating", "Power Rating", "Quantity"]
    )
    for r in rows:
        writer.writerow(
            [" ".join(r.refdes), r.value, r.footprint, r.mpn or "", r.manufacturer or "",
             r.tolerance or "", r.voltage_rating or "", r.current_rating or "",
             r.power_rating or "", r.qty]
        )
    return buf.getvalue()
