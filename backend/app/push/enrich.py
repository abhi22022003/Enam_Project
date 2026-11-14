"""On-demand enrichment of a pushed story (lazy: only when a card is shown)."""

import re
from urllib.parse import quote_plus

from .. import cache, llm
from ..sources import pdf, screener

UNIT_TO_CRORE = {"crore": 1.0, "lakh": 0.01, "million": 0.1, "thousand": 0.0001}


# ---------------------------------------------------------------- results


def _pick_results_filing(filings: list[dict]) -> dict | None:
    def rank(f):
        s = (f.get("subject") or "").lower()
        bad = any(k in s for k in ("press release", "presentation", "media", "newspaper", "call with", "suzuki"))
        good = "financial results" in s or "financial statements" in s or "outcome" in (f.get("nse_category") or "").lower()
        return (not bad, good, f.get("file_size") or "")

    cands = [f for f in filings if f.get("url")]
    return max(cands, key=rank) if cands else None


PL_TERMS = [
    r"revenue from operations|income from operations|interest earned",
    r"other income",
    r"total expenses|total expenditure|operating expenses",
    r"finance costs?|interest expended",
    r"depreciation",
    r"profit\s*/?\s*(\(loss\)\s*)?before (exceptional|tax)",
    r"tax expense|current tax|deferred tax",
    r"net profit|profit\s*/?\s*(\(loss\)\s*)?for the (period|quarter)",
    r"earnings per (equity )?share",
    r"paid[- ]up equity",
    r"provisions? \(other than tax\)|provisions and contingencies",
]


def _results_pages(pages: list[str]) -> list[tuple[int, str]]:
    """The main P&L table pages: score by how many standard line items appear, prefer consolidated."""
    scored = []
    for i, t in enumerate(pages):
        low = t.lower()
        hits = sum(1 for p in PL_TERMS if re.search(p, low))
        if hits < 5 or "segment" in low[:400]:
            continue
        has_q = bool(re.search(r"quarter ended|three months ended|quarter-ended", low))
        s = hits + (2 if "consolidated" in low[:1500] else 0) + (1 if has_q else 0)
        scored.append((s, i, t))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [(i, t) for _, i, t in scored[:2]]


RESULTS_PROMPT = """You are extracting numbers from an Indian listed company's quarterly results filing.
Use ONLY the table text below. Prefer CONSOLIDATED figures if both are present.
Take three columns: the latest quarter, the immediately preceding quarter, and the same quarter a year ago.
Report numbers exactly as printed in the table's unit (do not convert). Negative numbers stay negative.
- revenue: "Revenue from operations" (for banks: "Interest earned" / total interest income; for NBFCs: revenue from operations)
- other_income, finance_costs, depreciation: as printed (0 if absent)
- pbt: profit before tax (after exceptional items)
- pat: net profit for the period (total, before minority/non-controlling split)

Return JSON:
{{"basis": "consolidated|standalone", "unit": "crore|lakh|million|thousand", "is_lender": bool,
  "periods": [{{"role": "current|previous_quarter|year_ago_quarter", "label": "e.g. Sep 30, 2026",
               "revenue": n, "other_income": n, "finance_costs": n, "depreciation": n, "pbt": n, "pat": n}}]}}

TABLE TEXT:
{text}"""


def _valid(res: dict) -> bool:
    try:
        roles = {p["role"] for p in res["periods"]}
        if not {"current", "previous_quarter", "year_ago_quarter"} <= roles:
            return False
        for p in res["periods"]:
            rev, pbt, pat = float(p["revenue"]), float(p["pbt"]), float(p["pat"])
            if rev <= 0 or abs(pbt) > rev * 1.5 or abs(pat) > abs(pbt) * 1.6 + 1:
                return False
        return True
    except (KeyError, TypeError, ValueError):
        return False


def _pct(a, b):
    if a is None or b in (None, 0):
        return None
    return round((a - b) / abs(b) * 100, 1)


def _metrics_table(periods: dict, is_lender: bool) -> list[dict]:
    cur, prev, yago = periods["current"], periods["previous_quarter"], periods["year_ago_quarter"]
    rows = []
    for key, label in (("revenue", "Revenue"), ("ebitda", "EBITDA"), ("pbt", "PBT"), ("pat", "PAT")):
        if key == "ebitda" and is_lender:
            continue
        c, p, y = cur.get(key), prev.get(key), yago.get(key)
        rows.append(
            {
                "metric": label,
                "current": c,
                "previous": p,
                "year_ago": y,
                "qoq_pct": _pct(c, p),
                "yoy_pct": _pct(c, y),
                "margin": round(c / cur["revenue"] * 100, 1) if key != "revenue" and c is not None and cur.get("revenue") else None,
                "margin_year_ago": round(y / yago["revenue"] * 100, 1) if key != "revenue" and y is not None and yago.get("revenue") else None,
            }
        )
    return rows


def _from_screener(symbol: str) -> dict | None:
    try:
        co = screener.company(symbol)
    except Exception:
        return None
    q = co["tables"].get("quarters")
    if not q or len(q["periods"]) < 5:
        return None
    rows = q["rows"]
    rev = rows.get("Sales") or rows.get("Revenue")
    op = rows.get("Operating Profit")
    is_lender = "Financing Profit" in rows
    pbt, pat = rows.get("Profit before tax"), rows.get("Net Profit")
    if not (rev and pbt and pat):
        return None

    def at(i):
        return {
            "label": q["periods"][i],
            "revenue": rev[i],
            "ebitda": None if is_lender or not op else op[i],
            "pbt": pbt[i],
            "pat": pat[i],
        }

    periods = {"current": at(-1), "previous_quarter": at(-2), "year_ago_quarter": at(-5)}
    return {"periods": periods, "is_lender": is_lender, "basis": "consolidated" if co["consolidated"] else "standalone"}


def _filing_card(res: dict, target: dict, picked: list[tuple[int, str]]) -> dict:
    mult = UNIT_TO_CRORE.get(str(res.get("unit", "crore")).lower().split()[-1], 1.0)
    periods = {}
    for p in res["periods"]:
        f = {k: (float(p.get(k) or 0) * mult) for k in ("revenue", "other_income", "finance_costs", "depreciation", "pbt", "pat")}
        f["ebitda"] = f["pbt"] + f["finance_costs"] + f["depreciation"] - f["other_income"]
        f = {k: round(v, 1) for k, v in f.items()}
        f["label"] = p.get("label")
        periods[p["role"]] = f
    return {
        "source": "filing",
        "source_url": target["url"],
        "source_pages": [i + 1 for i, _ in picked],
        "basis": res.get("basis"),
        "is_lender": bool(res.get("is_lender")),
        "periods": periods,
    }


MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split()


def _month_year(label: str | None) -> tuple[int, int] | None:
    """'30-09-2026', '30.09.2026', "30th Sep'26", '30-Sep-26', 'Sep 2026' -> (8, 2026)."""
    low = (label or "").lower()
    num = re.search(r"\b\d{1,2}[./-](\d{1,2})[./-](\d{2,4})\b", low)
    if num:
        y = int(num.group(2))
        return int(num.group(1)) - 1, y + 2000 if y < 100 else y
    m = next((i for i, name in enumerate(MONTHS) if name in low), None)
    y = re.search(r"20(\d\d)|['-](\d\d)\b", low)
    return (m, 2000 + int(y.group(1) or y.group(2))) if m is not None and y else None


def _cross_check(card: dict, ref: dict | None) -> dict | None:
    """Compare against screener.in, but only when both describe the same quarter."""
    if not ref:
        return None
    cur, cur_ref = card["periods"]["current"], ref["periods"]["current"]
    a, b = _month_year(cur.get("label")), _month_year(cur_ref.get("label"))
    if not a or a != b:
        return None
    rev_ok, pat_ok = _pct(cur["revenue"], cur_ref["revenue"]), _pct(cur["pat"], cur_ref["pat"])
    return {
        "against": f"screener.in {cur_ref['label']}",
        "revenue_diff_pct": rev_ok,
        "pat_diff_pct": pat_ok,
        "agrees": rev_ok is not None and abs(rev_ok) <= 3 and pat_ok is not None and abs(pat_ok) <= 5,
    }


def results_card(symbol: str, filings: list[dict]) -> dict:
    target = _pick_results_filing(filings)
    key = f"{symbol}|{target['url'] if target else ''}"
    hit = cache.get_json("results_card", key)
    if hit:
        return hit

    ref = _from_screener(symbol)
    card: dict | None = None
    if target and llm.available():
        try:
            pages = pdf.pages(target["url"], max_pages=30)
            picked = _results_pages(pages)
            if picked:
                text = "\n\n".join(f"[page {i + 1}]\n{t}" for i, t in picked)[:16000]
                for tier in ("fast", "smart"):
                    try:
                        res = llm.complete_json(RESULTS_PROMPT.format(text=text), tier=tier)
                    except Exception:
                        continue
                    if not _valid(res):
                        continue
                    card = _filing_card(res, target, picked)
                    check = _cross_check(card, ref)
                    if check:
                        card["cross_check"] = check
                    if not check or check["agrees"]:
                        break
        except Exception:
            card = None

    if card and card.get("cross_check") and not card["cross_check"]["agrees"]:
        card = {
            "source": "screener",
            "source_url": target["url"] if target else None,
            "note": "The filing's figures did not reconcile with screener.in (e.g. gross vs net revenue), so screener.in's are shown.",
            **ref,
        }
    if not card and ref:
        card = {"source": "screener", "source_url": target["url"] if target else None, **ref}
    if not card:
        return {"type": "results", "error": "Could not read numbers from this filing."}

    card["type"] = "results"
    card["unit"] = "₹ Cr"
    card["table"] = _metrics_table(card["periods"], card.get("is_lender", False))
    card["ebitda_note"] = (
        "Not meaningful for lenders."
        if card.get("is_lender")
        else "EBITDA = PBT + finance costs + depreciation − other income."
        if card["source"] == "filing"
        else "Operating profit as reported by screener.in (≈ EBITDA)."
    )
    cache.set_json("results_card", key, card)
    return card


# ---------------------------------------------------------------- management change

MGMT_PROMPT = """From this Indian stock-exchange filing about a management/board change, extract every change.
Use ONLY the text. Indian filings usually include a "brief profile" of appointees: use it for background.
Return JSON:
{{"changes": [{{"person": str, "role": str, "change": "appointed|resigned|retired|re-appointed|redesignated|ceased|demise",
   "effective_date": str|null, "reason": str|null,
   "background": "2 short sentences: current/previous employers, years of experience, notable roles; null if not in filing",
   "education": str|null, "previous_roles": [str]}}],
 "headline": "<= 14 words, e.g. 'CFO Jane Doe resigns; John Roe (ex-Unilever) to take over'"}}

FILING TEXT:
{text}"""


def management_card(symbol: str, company: str, filings: list[dict]) -> dict:
    key = "|".join(sorted(f["id"] for f in filings))
    hit = cache.get_json("mgmt_card", key)
    if hit:
        return hit
    if not llm.available():
        return {"type": "management_change", "changes": [], "headline": None, "llm": False}
    changes, headline = [], None
    for f in filings[:3]:
        if not f.get("url"):
            continue
        try:
            text = pdf.text(f["url"], max_pages=6, max_chars=12000)
            res = llm.complete_json(MGMT_PROMPT.format(text=text), tier="fast")
        except Exception:
            continue
        for c in res.get("changes", []):
            if not c.get("person"):
                continue
            c["linkedin_search"] = "https://www.linkedin.com/search/results/people/?keywords=" + quote_plus(
                f"{c['person']} {company}"
            )
            c["source_url"] = f["url"]
            changes.append(c)
        headline = headline or res.get("headline")
    card = {"type": "management_change", "changes": changes, "headline": headline}
    cache.set_json("mgmt_card", key, card)
    return card


# ---------------------------------------------------------------- generic one-liner

SUMMARY_PROMPT = """Summarise this Indian stock-exchange filing for a busy portfolio investor in ONE line (<= 22 words).
State the concrete fact (what, how much, when). No adjectives, no "the company informed".
If it carries numbers (order value, stake %, rating, amount), include them.
Return JSON: {{"summary": str, "key_figure": str|null}}

{text}"""


def summary_card(filing: dict) -> dict:
    if filing.get("nse_summary"):
        return {"type": "summary", "summary": filing["nse_summary"], "source": "nse"}
    if filing.get("summary"):
        return {"type": "summary", "summary": filing["summary"], "source": "llm"}
    hit = cache.get_json("summary_card", filing["id"])
    if hit:
        return hit
    if not llm.available() or not filing.get("url"):
        return {"type": "summary", "summary": None}
    try:
        text = pdf.text(filing["url"], max_pages=3, max_chars=7000)
        res = llm.complete_json(SUMMARY_PROMPT.format(text=text), tier="fast")
        card = {"type": "summary", "summary": res.get("summary"), "key_figure": res.get("key_figure"), "source": "llm"}
    except Exception:
        return {"type": "summary", "summary": None}
    cache.set_json("summary_card", filing["id"], card)
    return card


def enrich(story: dict) -> dict:
    cat = story.get("category")
    filings = story.get("filings", [])
    if cat == "results" and story.get("subtype") in ("filed", "press_release"):
        return results_card(story["symbol"], filings)
    if cat == "management_change":
        return management_card(story["symbol"], story.get("company", ""), filings)
    primary = max(filings, key=lambda f: f.get("score", 0)) if filings else {}
    return summary_card(primary) if primary else {"type": "summary", "summary": None}
