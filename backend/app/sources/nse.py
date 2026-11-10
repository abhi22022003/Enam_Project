from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from .. import cache
from ..http import client

API = "https://www.nseindia.com/api/corporate-announcements"
HEADERS = {"Referer": "https://www.nseindia.com/", "Accept": "application/json"}


def _normalize(row: dict) -> dict:
    ts = datetime.strptime(row["sort_date"], "%Y-%m-%d %H:%M:%S")
    return {
        "id": str(row.get("seq_id")),
        "symbol": row.get("symbol"),
        "company": row.get("sm_name"),
        "industry": row.get("smIndustry"),
        "time": ts.isoformat(),
        "nse_category": (row.get("desc") or "").strip(),
        "text": (row.get("attchmntText") or "").strip(),
        "url": row.get("attchmntFile"),
        "file_size": row.get("fileSize"),
        "nse_summary": row.get("voiceSummary"),
    }


def _fetch(symbol: str, start: date, end: date) -> list[dict]:
    params = {
        "index": "equities",
        "symbol": symbol,
        "from_date": start.strftime("%d-%m-%Y"),
        "to_date": end.strftime("%d-%m-%Y"),
    }
    r = client().get(API, params=params, headers=HEADERS)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list):
        return []
    return [_normalize(x) for x in data if x.get("sort_date")]


def announcements(symbol: str, start: date, end: date) -> list[dict]:
    # Past windows are immutable; anything touching today refreshes every 10 minutes.
    ttl = 600 if end >= date.today() - timedelta(days=1) else None
    key = f"{symbol}|{start}|{end}"
    try:
        return cache.cached_json("nse_ann", key, ttl, lambda: _fetch(symbol, start, end))
    except Exception:
        stale = cache.get_json("nse_ann", key)
        if stale is not None:
            return stale
        archive = cache.get_json("nse_archive", symbol) or []
        return [r for r in archive if start <= datetime.fromisoformat(r["time"]).date() <= end]


def archive(symbol: str, days: int = 120) -> int:
    """Store a wide window per symbol, used as an offline fallback for any narrower window."""
    end = date.today()
    rows = _fetch(symbol, end - timedelta(days=days), end)
    cache.set_json("nse_archive", symbol, rows)
    return len(rows)


def announcements_for(symbols: list[str], start: date, end: date) -> list[dict]:
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda s: announcements(s, start, end), symbols))
    rows = [r for batch in results for r in batch]
    rows.sort(key=lambda r: r["time"], reverse=True)
    return rows
