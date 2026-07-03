"""Tests against the fixture project: a hierarchical design where the same
subsheet (rail.kicad_sch) is instantiated twice — the case that silently
breaks flat traversals — plus a multi-PCB directory."""

from pathlib import Path

import pytest

from kicad_mcp import config, file_parser
from kicad_mcp.tools import bom

FIXTURES = Path(__file__).parent / "fixtures"
HIER = FIXTURES / "hier"
MULTI = FIXTURES / "multiboard"
ROOT_SCH = HIER / "hier.kicad_sch"
PCB = HIER / "hier.kicad_pcb"

SHEET_A = "bbbbbbbb-0000-0000-0000-000000000001"
SHEET_B = "bbbbbbbb-0000-0000-0000-000000000002"


def _kicad_cli_available() -> bool:
    try:
        config.find_kicad_cli()
        return True
    except config.ConfigError:
        return False


# ── hierarchy expansion ─────────────────────────────────────────────────────


def test_reused_subsheet_yields_one_component_per_instance():
    symbols = file_parser.load_all_symbols(ROOT_SCH)
    by_ref = {s.refdes: s for s in symbols}
    assert set(by_ref) == {"R101", "R201"}
    assert by_ref["R101"].sheet_path == (SHEET_A,)
    assert by_ref["R201"].sheet_path == (SHEET_B,)
    # same source symbol, distinct instances
    assert by_ref["R101"].uuid == by_ref["R201"].uuid


def test_hierarchy_tree_has_both_instances():
    tree = file_parser.get_hierarchy(ROOT_SCH)
    assert len(tree.children) == 2
    assert {c.name for c in tree.children} == {"rail_a", "rail_b"}
    assert all(c.file == "rail.kicad_sch" for c in tree.children)
    assert all(c.symbol_count == 1 for c in tree.children)


# ── schematic ↔ board join ──────────────────────────────────────────────────


def test_components_join_by_refdes_with_path_crosscheck():
    components = file_parser.get_components(ROOT_SCH, PCB)
    by_ref = {c.refdes: c for c in components}
    assert set(by_ref) == {"R101", "R201"}
    for c in by_ref.values():
        assert c.on_board
        assert c.layer == "F.Cu"
        assert c.warnings == []  # paths agree → board in sync
    assert by_ref["R101"].nets == {"1": "RAIL_A_OUT", "2": "GND"}
    assert by_ref["R201"].nets == {"1": "RAIL_B_OUT", "2": "GND"}


def test_schematic_only_when_no_board():
    components = file_parser.get_components(ROOT_SCH, None)
    assert all(not c.on_board and c.layer is None and c.position is None for c in components)


# ── nets ────────────────────────────────────────────────────────────────────


def test_nets_with_class_assignment_and_patterns():
    nets = {n.name: n for n in file_parser.get_nets(PCB, HIER / "hier.kicad_pro")}
    assert nets["GND"].net_class == "Power"  # explicit assignment
    assert nets["RAIL_A_OUT"].net_class == "Power"  # wildcard pattern RAIL_*
    assert nets["GND"].pin_count == 2
    assert {(p.refdes, p.pad_number) for p in nets["GND"].pins} == {("R101", "2"), ("R201", "2")}


def test_diff_pair_derivation():
    all_nets = {"USB_P", "USB_N", "CLK+", "CLK-", "LONELY_P", "GND"}
    assert file_parser._diff_pair_partner("USB_P", all_nets) == "USB_N"
    assert file_parser._diff_pair_partner("CLK-", all_nets) == "CLK+"
    assert file_parser._diff_pair_partner("LONELY_P", all_nets) is None
    assert file_parser._diff_pair_partner("GND", all_nets) is None


# ── multi-PCB disambiguation ────────────────────────────────────────────────


def test_multiple_pcbs_error_lists_candidates():
    with pytest.raises(config.ConfigError) as err:
        config.resolve_pcb_file(MULTI)
    assert "main.kicad_pcb" in str(err.value)
    assert "test-jig.kicad_pcb" in str(err.value)


def test_multiple_pcbs_resolved_by_parameter():
    resolved = config.resolve_pcb_file(MULTI, "test-jig.kicad_pcb")
    assert resolved.name == "test-jig.kicad_pcb"


# ── BOM ─────────────────────────────────────────────────────────────────────


def test_bom_groups_instances_and_normalizes_properties():
    rows = bom.get_bom(ROOT_SCH)
    assert len(rows) == 1
    row = rows[0]
    assert row.refdes == ["R101", "R201"]
    assert row.qty == 2
    assert row.value == "10k"
    assert row.mpn == "RC0603FR-0710KL"  # matched from "MPN#" via fuzzy alias
    assert row.tolerance == "1%"


# ── project info ────────────────────────────────────────────────────────────


def test_project_info():
    info = file_parser.get_project_info(HIER)
    assert info.name == "hier"
    assert info.component_count == 2
    assert info.net_count == 3
    assert info.sheet_count == 3  # root + two instances
    assert info.kicad_version == "9.0"


# ── kicad-cli backed tools (need KiCad installed) ───────────────────────────


needs_kicad = pytest.mark.skipif(not _kicad_cli_available(), reason="kicad-cli not installed")


@needs_kicad
def test_run_drc_reports_fixture_violations():
    from kicad_mcp.tools import drc

    violations = drc.run_drc(PCB)
    assert len(violations) >= 1
    assert all(v.severity in ("error", "warning") for v in violations)


@needs_kicad
def test_export_netlist_resolves_instances():
    from kicad_mcp.tools import export

    netlist = export.export_netlist(ROOT_SCH)
    assert '(ref "R101")' in netlist
    assert '(ref "R201")' in netlist
