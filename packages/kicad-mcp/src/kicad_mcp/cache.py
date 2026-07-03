"""mtime-keyed in-memory parse cache.

Re-parsing a 500-component board costs seconds per tool call; cache parses
keyed on (path, mtime_ns, size). Size guards against same-second rewrites on
filesystems with coarse mtime granularity. The cache lives in the MCP server
process — wiped on restart, which is fine for a local stdio server.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable, TypeVar

T = TypeVar("T")

_RETRY_DELAY_S = 0.15

_cache: dict[str, tuple[tuple[int, int], object]] = {}


def get_or_parse(path: str | Path, parser: Callable[[str], T]) -> T:
    """Return the cached parse for path, re-parsing if the file changed.

    Parse failures are retried once after a short delay — KiCad may be
    mid-write when the tool fires (autosave, engineer hits ⌘S).
    """
    path = str(path)
    st = os.stat(path)
    key = (st.st_mtime_ns, st.st_size)

    entry = _cache.get(path)
    if entry is not None and entry[0] == key:
        return entry[1]  # type: ignore[return-value]

    try:
        parsed = parser(path)
    except Exception:
        time.sleep(_RETRY_DELAY_S)
        # Re-stat: if the writer finished, key the cache on the final file.
        st = os.stat(path)
        key = (st.st_mtime_ns, st.st_size)
        try:
            parsed = parser(path)
        except Exception as err:
            raise RuntimeError(
                f"Failed to parse {path} (retried once — if KiCad was saving, "
                f"try again; otherwise the file may use a format this parser "
                f"doesn't support yet): {err}"
            ) from err

    _cache[path] = (key, parsed)
    return parsed


def clear() -> None:
    _cache.clear()
