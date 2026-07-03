"""Environment configuration and kicad-cli / project file discovery."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

KICAD_CLI_MACOS = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
# Windows installs are versioned; try newest first.
KICAD_CLI_WINDOWS = [
    rf"C:\Program Files\KiCad\{v}.0\bin\kicad-cli.exe" for v in (11, 10, 9, 8, 7)
]

RESISTANCE_API_URL_DEFAULT = "http://localhost:3000"


class ConfigError(Exception):
    """Raised when required configuration or files cannot be resolved."""


def find_kicad_cli() -> str:
    """Locate kicad-cli. Engineers on a standard install should never have to
    set KICAD_CLI_PATH manually."""
    override = os.environ.get("KICAD_CLI_PATH")
    if override:
        if Path(override).is_file():
            return override
        raise ConfigError(f"KICAD_CLI_PATH is set to {override!r} but no file exists there.")

    on_path = shutil.which("kicad-cli")
    if on_path:
        return on_path

    if Path(KICAD_CLI_MACOS).is_file():
        return KICAD_CLI_MACOS
    for candidate in KICAD_CLI_WINDOWS:
        if Path(candidate).is_file():
            return candidate

    raise ConfigError(
        "kicad-cli not found. Install KiCad 10 (https://www.kicad.org/download/) "
        "or set KICAD_CLI_PATH to the kicad-cli binary."
    )


def resistance_api_url() -> str:
    return os.environ.get("RESISTANCE_API_URL", RESISTANCE_API_URL_DEFAULT).rstrip("/")


def resistance_api_token() -> str | None:
    # Reserved: Resistance has no auth yet (Phase 1). Sent as a Bearer token
    # when set so nothing here changes when auth lands.
    return os.environ.get("RESISTANCE_API_TOKEN")


def resolve_project_dir(project_dir: str | None) -> Path:
    """Per-call project_dir parameter overrides KICAD_PROJECT_DIR."""
    raw = project_dir or os.environ.get("KICAD_PROJECT_DIR")
    if not raw:
        raise ConfigError(
            "No project directory. Pass project_dir or set KICAD_PROJECT_DIR."
        )
    path = Path(raw).expanduser()
    if not path.is_dir():
        raise ConfigError(f"Project directory does not exist: {path}")
    return path


def _resolve_single(
    project_dir: Path, pattern: str, override: str | None, env_var: str, kind: str
) -> Path:
    """Resolve exactly one file matching pattern — never silently guess
    between multiple candidates (test jigs, panelized variants, rev-A/rev-B
    side by side are all common)."""
    raw = override or os.environ.get(env_var)
    if raw:
        path = Path(raw)
        if not path.is_absolute():
            path = project_dir / path
        if not path.is_file():
            raise ConfigError(f"{kind} not found: {path}")
        return path

    candidates = sorted(p for p in project_dir.glob(pattern) if p.is_file())
    if not candidates:
        raise ConfigError(f"No {pattern} file in {project_dir}")
    if len(candidates) > 1:
        names = ", ".join(p.name for p in candidates)
        raise ConfigError(
            f"Multiple {kind}s in {project_dir}: {names}. "
            f"Disambiguate with the per-call parameter or {env_var}. "
            f"(Use list_pcb_files / get_project_info to show candidates to the engineer.)"
        )
    return candidates[0]


def resolve_pcb_file(project_dir: Path, pcb_file: str | None = None) -> Path:
    return _resolve_single(project_dir, "*.kicad_pcb", pcb_file, "KICAD_PCB_FILE", "board file")


def list_pcb_files(project_dir: Path) -> list[Path]:
    return sorted(p for p in project_dir.glob("*.kicad_pcb") if p.is_file())


def resolve_root_schematic(project_dir: Path, sch_file: str | None = None) -> Path:
    """Root schematic: the .kicad_sch matching the .kicad_pro basename.
    Subsheet files also live in the project dir, so a bare glob would be
    ambiguous on any hierarchical design."""
    if sch_file:
        path = Path(sch_file)
        if not path.is_absolute():
            path = project_dir / path
        if not path.is_file():
            raise ConfigError(f"Schematic not found: {path}")
        return path

    pro_files = sorted(project_dir.glob("*.kicad_pro"))
    for pro in pro_files:
        candidate = pro.with_suffix(".kicad_sch")
        if candidate.is_file():
            return candidate

    return _resolve_single(
        project_dir, "*.kicad_sch", None, "KICAD_SCH_FILE", "root schematic"
    )


def resolve_project_file(project_dir: Path) -> Path | None:
    pro_files = sorted(project_dir.glob("*.kicad_pro"))
    return pro_files[0] if pro_files else None
