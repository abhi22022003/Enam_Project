import re
from datetime import date, datetime, timedelta

from ..sources import nse, prices
from .classify import CATEGORIES, classify

CRITICAL, NOTABLE = 75, 40
INTEREST_BOOST = 12
CLUSTER_HOURS = 72
MARKET_CLOSE = (15, 30)

DEFAULT_INTERESTS = ["results", "M&A", "management_change", "litigation", "fund_raise", "credit_rating", "pledging"]


def fiscal_quarter(d: date) -> str:
    fy = d.year + 1 if d.month >= 4 else d.year
    q = {4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3, 1: 4, 2: 4, 3: 4}[d.month]
    return f"Q{q} FY{str(fy)[-2:]}"


MONTHS = "january february march april may june july august september october november december".split()


def _period_from_text(text: str) -> str | None:
    t = text.lower()
    m = re.search(r"ended\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})", t) or re.search(
        r"ended\s+([a-z]+)\s+(\d{1,2}),?\s+(\d{4})", t
    )
    if not m:
        return None
    a, b, y = m.groups()
    month = a if a.isalpha() else b
    if month[:3] not in [x[:3] for x in MONTHS]:
        return None
    mi = [x[:3] for x in MONTHS].index(month[:3]) + 1
    return fiscal_quarter(date(int(y), mi, 28))


def _headline(cat: str, sub: str | None, primary: dict, members: list[dict]) -> str:
    if cat == "results" and sub in ("filed", "press_release", "scheduled"):
        period = next((p for f in members if (p := _period_from_text(f.get("text", "")))), None)
        if sub == "scheduled":
            return f"Board meeting scheduled to approve {period or 'results'}"
        return f"{period + ' results' if period else 'Results'} filed"
    return primary["subject"]


def _price_reaction(days: list[dict], ts: datetime) -> dict | None:
    after_close = (ts.hour, ts.minute) >= MARKET_CLOSE
    for d in days:
        dd = date.fromisoformat(d["date"])
        if dd > ts.date() or (dd == ts.date() and not after_close):
            return {"date": d["date"], "change_pct": d["change_pct"], "vol_ratio": d["vol_ratio"]}
    return None


def build_stories(rows: list[dict], interests: set[str], px: dict) -> list[dict]:
    rows = sorted(rows, key=lambda r: r["time"])
    clusters: list[list[dict]] = []
    open_by_key: dict[tuple, list[dict]] = {}
    for r in rows:
        key = (r["symbol"], r["category"])
        cur = open_by_key.get(key)
        ts = datetime.fromisoformat(r["time"])
        if cur and ts - datetime.fromisoformat(cur[-1]["time"]) <= timedelta(hours=CLUSTER_HOURS) and r["category"] != "unclassified":
            cur.append(r)
        else:
            cur = [r]
            clusters.append(cur)
            open_by_key[key] = cur

    stories = []
    for members in clusters:
        primary = max(members, key=lambda f: (f["score"], f["time"]))
        cat, sub = primary["category"], primary.get("subtype")
        s = max(f["score"] for f in members)
        if cat in interests and s >= 30:
            s += INTEREST_BOOST
        latest = max(members, key=lambda f: f["time"])
        first_ts = datetime.fromisoformat(min(f["time"] for f in members))
        tier = "critical" if s >= CRITICAL else "notable" if s >= NOTABLE else "routine"
        stories.append(
            {
                "id": f"{primary['symbol']}-{primary['id']}",
                "symbol": primary["symbol"],
                "company": primary["company"],
                "category": cat,
                "category_label": CATEGORIES.get(cat, cat),
                "subtype": sub,
                "score": s,
                "tier": tier,
                "headline": _headline(cat, sub, primary, members),
                "summary": primary.get("nse_summary") or primary.get("summary"),
                "time": latest["time"],
                "price_reaction": _price_reaction(px.get(primary["symbol"], {}).get("days", []), first_ts),
                "filings": [
                    {k: f.get(k) for k in ("id", "time", "subject", "nse_category", "url", "file_size", "score", "subtype", "nse_summary", "summary", "text", "classified_by")}
                    for f in sorted(members, key=lambda f: f["time"], reverse=True)
                ],
            }
        )
    stories.sort(key=lambda s: (s["tier"] != "critical", s["tier"] != "notable", -s["score"], -datetime.fromisoformat(s["time"]).timestamp()))
    return stories


def market_alerts(px: dict, start: datetime, end: datetime, vol_x: float, move_pct: float, stories: list[dict]) -> list[dict]:
    alerts = []
    for sym, snap in px.items():
        days = snap.get("days", [])
        in_window = [d for d in days if start.date() <= date.fromisoformat(d["date"]) <= end.date()]
        if not in_window and days:
            in_window = [days[-1]]
        for d in in_window:
            triggers = []
            if d["vol_ratio"] is not None and d["vol_ratio"] >= vol_x:
                triggers.append({"kind": "volume", "text": f"Volume {d['vol_ratio']:.1f}× its 20-day average"})
            if d["change_pct"] is not None and abs(d["change_pct"]) >= move_pct:
                triggers.append({"kind": "price", "text": f"{'Up' if d['change_pct'] > 0 else 'Down'} {abs(d['change_pct']):.1f}% on the day"})
            if d["close"] >= d["high_52w"] and len(days) > 200:
                triggers.append({"kind": "52w_high", "text": "Closed at a 52-week high"})
            if not triggers:
                continue
            dd = date.fromisoformat(d["date"])
            context = [
                {"story_id": s["id"], "headline": s["headline"], "category_label": s["category_label"]}
                for s in stories
                if s["symbol"] == sym
                and s["tier"] != "routine"
                and timedelta(days=0) <= dd - datetime.fromisoformat(s["time"]).date() <= timedelta(days=2)
            ]
            mag = max((d["vol_ratio"] or 0) / vol_x, abs(d["change_pct"] or 0) / move_pct)
            alerts.append(
                {
                    "id": f"mkt-{sym}-{d['date']}",
                    "kind": "market",
                    "symbol": sym,
                    "date": d["date"],
                    "close": d["close"],
                    "change_pct": d["change_pct"],
                    "vol_ratio": d["vol_ratio"],
                    "triggers": triggers,
                    "context": context[:2],
                    "unexplained": not context,
                    "severity": round(mag, 2),
                }
            )
    alerts.sort(key=lambda a: (a["date"], a["severity"]), reverse=True)
    return alerts


def filing_alerts(stories: list[dict], interests: set[str]) -> list[dict]:
    return [
        {
            "id": f"fil-{s['id']}",
            "kind": "filing",
            "symbol": s["symbol"],
            "story_id": s["id"],
            "headline": s["headline"],
            "category_label": s["category_label"],
            "time": s["time"],
        }
        for s in stories
        if s["category"] in interests and s["tier"] == "critical"
    ]


def build_digest(
    symbols: list[str],
    start: datetime,
    end: datetime,
    interests: list[str] | None = None,
    vol_x: float = 2.0,
    move_pct: float = 4.0,
    allow_llm: bool = True,
) -> dict:
    interests_set = set(interests or DEFAULT_INTERESTS)
    rows = nse.announcements_for(symbols, start.date(), end.date())
    rows = [r for r in rows if start <= datetime.fromisoformat(r["time"]) <= end]
    window_days = (end - start).total_seconds() / 86400
    classify(rows, allow_llm=allow_llm and window_days <= 15)

    px = prices.snapshot(symbols)
    stories = build_stories(rows, interests_set, px)
    m_alerts = market_alerts(px, start, end, vol_x, move_pct, stories)
    f_alerts = filing_alerts(stories, interests_set)

    top = [s for s in stories if s["tier"] != "routine"]
    routine = [s for s in stories if s["tier"] == "routine"]
    by_cat: dict[str, int] = {}
    for s in routine:
        by_cat[s["category_label"]] = by_cat.get(s["category_label"], 0) + len(s["filings"])

    return {
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "counts": {
            "filings": len(rows),
            "stories": len(stories),
            "critical": sum(1 for s in stories if s["tier"] == "critical"),
            "notable": sum(1 for s in stories if s["tier"] == "notable"),
            "routine_filings": sum(len(s["filings"]) for s in routine),
            "companies_with_news": len({s["symbol"] for s in top}),
        },
        "alerts": f_alerts + m_alerts,
        "stories": top,
        "routine": routine,
        "routine_by_category": sorted(by_cat.items(), key=lambda x: -x[1]),
        "settings": {"interests": sorted(interests_set), "vol_x": vol_x, "move_pct": move_pct},
    }
