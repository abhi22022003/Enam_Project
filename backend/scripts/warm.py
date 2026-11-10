"""Pre-warm every demo path, then copy the JSON cache into ./snapshot (committed).

    uv run python -m scripts.warm            # portfolio digest + enrichments + research
    uv run python -m scripts.warm --quick    # skip the slow research sections
"""

import shutil
import sys
import time
from datetime import datetime, timedelta

from app import llm
from app.cache import SNAPSHOT_DIR
from app.config import CACHE_DIR, PORTFOLIO, RESEARCH_DEMO
from app.pull import research
from app.push.digest import build_digest
from app.push.enrich import enrich
from app.sources import nse, prices

SKIP_NAMESPACES = {"pdf"}
SYMBOLS = [p["symbol"] for p in PORTFOLIO]


def step(label, fn, *args):
    t = time.time()
    try:
        out = fn(*args)
        print(f"  ok   {label} ({time.time() - t:.1f}s)")
        return out
    except Exception as e:
        print(f"  FAIL {label}: {str(e)[:160]}")
        return None


def main(quick: bool) -> None:
    print("NSE archives")
    for s in SYMBOLS:
        step(f"archive {s}", nse.archive, s)
    step("prices", prices.history, SYMBOLS)

    now = datetime.now()
    for days in (1, 3, 7, 30):
        print(f"Digest {days}d")
        d = step(f"digest {days}d", build_digest, SYMBOLS, now - timedelta(days=days), now)
        if not d or days > 7:
            continue
        for s in d["stories"]:
            step(f"enrich {s['symbol']} {s['category']}", enrich, s)

    if quick:
        return
    print("Research")
    for s in SYMBOLS + RESEARCH_DEMO:
        step(f"overview {s}", research.overview, s)
    for s in RESEARCH_DEMO + ["TITAN", "TCS", "DIXON", "HDFCBANK"]:
        for section in ("business", "promises", "bullbear"):
            step(f"{section} {s}", getattr(research, section), s)
    for s in RESEARCH_DEMO[:2]:
        step(f"governance {s}", research.governance, s)


def snapshot() -> None:
    if SNAPSHOT_DIR.exists():
        shutil.rmtree(SNAPSHOT_DIR)
    for ns in CACHE_DIR.iterdir():
        if ns.is_dir() and ns.name not in SKIP_NAMESPACES:
            shutil.copytree(ns, SNAPSHOT_DIR / ns.name, ignore=shutil.ignore_patterns("*.bin", "*.tmp"))
    size = sum(f.stat().st_size for f in SNAPSHOT_DIR.rglob("*") if f.is_file())
    print(f"snapshot: {size / 1e6:.1f} MB in {SNAPSHOT_DIR}")


if __name__ == "__main__":
    main("--quick" in sys.argv)
    snapshot()
    print("LLM usage:", llm.usage())
