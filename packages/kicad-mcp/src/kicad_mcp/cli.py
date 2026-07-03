"""kicad-cli subprocess wrapper."""

from __future__ import annotations

import subprocess
from pathlib import Path

from .config import find_kicad_cli

_TIMEOUT_S = 120


class KicadCliError(Exception):
    pass


def run(args: list[str], cwd: Path | None = None) -> str:
    """Run kicad-cli with args; return stdout. Raises KicadCliError with the
    CLI's own stderr on failure — kicad-cli messages are engineer-readable."""
    binary = find_kicad_cli()
    try:
        result = subprocess.run(
            [binary, *args],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
            cwd=cwd,
        )
    except subprocess.TimeoutExpired as err:
        raise KicadCliError(
            f"kicad-cli timed out after {_TIMEOUT_S}s: {' '.join(args)}"
        ) from err
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise KicadCliError(
            f"kicad-cli {' '.join(args[:3])}… failed (exit {result.returncode}): {detail}"
        )
    return result.stdout


def version() -> str:
    return run(["version"]).strip()
