"""Disk cache with a committed, read-only snapshot fallback.

CACHE_DIR    live cache (ephemeral on free hosting)
SNAPSHOT_DIR pre-warmed JSON shipped with the repo, so the demo still works if an
             upstream (e.g. NSE blocking cloud IPs) is unreachable.
"""

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Callable

from .config import BASE_DIR, CACHE_DIR

SNAPSHOT_DIR = BASE_DIR / "snapshot"


def _name(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:32]


def _path(namespace: str, key: str, ext: str, root: Path = CACHE_DIR) -> Path:
    folder = root / namespace
    if root == CACHE_DIR:
        folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{_name(key)}.{ext}"


def _load(p: Path) -> Any | None:
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def get_json(namespace: str, key: str, ttl: float | None = None) -> Any | None:
    """Fresh value within ttl; with ttl=None any value, falling back to the snapshot."""
    p = _path(namespace, key, "json")
    if p.exists() and (ttl is None or time.time() - p.stat().st_mtime <= ttl):
        return _load(p)
    if ttl is None:
        snap = _path(namespace, key, "json", SNAPSHOT_DIR)
        if snap.exists():
            return _load(snap)
    return None


def set_json(namespace: str, key: str, value: Any) -> None:
    p = _path(namespace, key, "json")
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, default=str))
    tmp.replace(p)


def cached_json(namespace: str, key: str, ttl: float | None, fn: Callable[[], Any]) -> Any:
    hit = get_json(namespace, key, ttl)
    if hit is not None:
        return hit
    value = fn()
    if value is not None:
        set_json(namespace, key, value)
    return value


def get_bytes(namespace: str, key: str) -> bytes | None:
    p = _path(namespace, key, "bin")
    return p.read_bytes() if p.exists() else None


def set_bytes(namespace: str, key: str, data: bytes) -> None:
    _path(namespace, key, "bin").write_bytes(data)
