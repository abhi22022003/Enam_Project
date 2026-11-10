"""Announcement classification + materiality scoring.

Tiered for cost: NSE's own category label -> keyword rules on the filing subject ->
(only for genuinely ambiguous filings) one batched cheap-LLM call over page 1 of the PDFs.
"""

import re
from concurrent.futures import ThreadPoolExecutor

from .. import cache, llm
from ..sources import pdf

CATEGORIES = {
    "results": "Results",
    "M&A": "M&A",
    "fund_raise": "Fund raise",
    "management_change": "Management",
    "litigation": "Litigation / Regulatory",
    "insider_trading": "Insider trade",
    "earnings_call": "Earnings call",
    "investor_meetings": "Investor meet",
    "credit_rating": "Credit rating",
    "dividend": "Dividend",
    "bonus_split": "Bonus / Split",
    "capex": "Capex",
    "press_release": "Press release",
    "postal_ballot": "Postal ballot",
    "agm_egm": "AGM / EGM",
    "pledging": "Pledging",
    "unclassified": "Routine",
}

DESC_DIRECT = {
    "Copy of Newspaper Publication": ("unclassified", "newspaper"),
    "ESOP/ESOS/ESPS": ("unclassified", "esop"),
    "Certificate under SEBI (Depositories and Participants) Regulations, 2018": ("unclassified", "compliance"),
    "Trading Window": ("unclassified", "trading_window"),
    "Amendment to AOA/MOA": ("unclassified", "charter"),
    "Address Change": ("unclassified", "admin"),
    "Corrigendum": ("unclassified", "admin"),
    "Monitoring Agency Report": ("unclassified", "compliance"),
    "Investor Presentation": ("results", "deck"),
    "Bagging/Receiving of orders/contracts": ("press_release", "order_win"),
    "News Verification": ("press_release", "clarification"),
    "Rumour Verification - Regulation 30(11)": ("press_release", "clarification"),
    "Credit Rating": ("credit_rating", None),
    "Credit Rating- New": ("credit_rating", None),
    "Credit Rating- Others": ("credit_rating", None),
    "Credit Rating- Revision": ("credit_rating", None),
    "Dividend": ("dividend", None),
    "Acquisition": ("M&A", None),
    "Amalgamation/Merger": ("M&A", None),
    "Scheme of Arrangement": ("M&A", None),
    "Sale or disposal": ("M&A", "divestment"),
    "Other Restructuring": ("M&A", None),
    "Corporate Insolvency Resolution Process": ("litigation", "insolvency"),
    "Action(s) taken or orders passed": ("litigation", None),
    "Qualified Institutional Placement": ("fund_raise", "equity"),
    "Preferential issue": ("fund_raise", "equity"),
    "Issue of Securities": ("fund_raise", None),
    "Change in Management": ("management_change", None),
    "Resignation of Director/KMP/SMP": ("management_change", None),
    "Change in Director(s)": ("management_change", None),
    "Retirement": ("management_change", None),
    "Appointment": ("management_change", None),
    "Resignation": ("management_change", None),
    "Demise": ("management_change", None),
    "Shareholders meeting": ("agm_egm", None),
}

# Ordered: first match wins.
KEYWORD_RULES: list[tuple[str, str]] = [
    ("results", r"financial results|unaudited|audited (standalone|consolidated|financial)|results for the (quarter|half|year|period)"),
    ("earnings_call", r"transcript|audio recording|earnings (conference )?call|con\.? ?call|conference call"),
    ("management_change", r"appointment|appointed|resign|cessation|re-?designat|retire|change in (management|directors?|kmp|key managerial)|demise|superannuat"),
    ("litigation", r"nclt|nclat|insolvency|penalt|show cause|tax demand|demand order|litigation|court|arbitra|search (and|&) seizure|sebi order|adjudicat|notice from|warning letter|import alert"),
    ("M&A", r"acqui|amalgamat|merger|demerg|joint venture|takeover|scheme of arrangement|stake|incorporation of .*subsidiary|wholly[- ]owned subsidiary|divest|disposal"),
    ("fund_raise", r"commercial paper|non-convertible|debenture|\bncd|qualified institutions? placement|\bqip\b|rights issue|preferential|buy-?back|raising of funds|fund rais|allotment"),
    ("credit_rating", r"credit rating|rating agency|crisil|icra|care ratings|india ratings"),
    ("pledging", r"pledge|encumbrance"),
    ("insider_trading", r"regulation 7\(2\)|regulation 29|\bsast\b|insider trading|promoter.*(acquisition|sale) of shares"),
    ("dividend", r"dividend"),
    ("bonus_split", r"bonus|sub-?division|stock split|split of"),
    ("capex", r"capacity|greenfield|brownfield|new plant|manufacturing facility|capex|capital expenditure|commissioning|commercial production"),
    ("postal_ballot", r"postal ballot"),
    ("agm_egm", r"annual general meeting|\bagm\b|extra-?ordinary general meeting|\begm\b|scrutini[sz]er"),
    ("investor_meetings", r"analyst|investor (meet|conference|day)|institutional investor|schedule of meet|investors? meet"),
    ("press_release", r"press release|media (release|statement)|launch|order|contract|partnership|collaborat|approval|usfda|agreement|sales (volume|for|in)|business update|award|recogni[sz]|positioned as"),
    ("unclassified", r"newspaper|esop|esos|stock option|certificate|trading window|duplicate share|loss of share|74\(5\)|compliance|esg|brsr|sustainability|auditor|secretarial|intimation under regulation 39|closure of"),
]

GENERIC_TEXT = re.compile(
    r"informed the exchange (about|regarding) '?(general updates|updates|disclosure under regulation 30[^']*)'?\.?$"
    r"|^(general updates|updates)$",
    re.I,
)

SENIOR_ROLE = re.compile(r"\b(ceo|cfo|coo|md\b|managing director|chief executive|chief financial|chairman|chairperson|whole[- ]time director|executive director)", re.I)


def clean_subject(row: dict) -> str:
    t = row.get("text") or ""
    company = row.get("company") or ""
    t = re.sub(rf"^{re.escape(company)}\s+has\s+(informed|submitted to)\s+the\s+Exchange\s*(,\s*)?(about|regarding|that|the)?\s*", "", t, flags=re.I)
    t = t.strip(" '.\"")
    if not t:
        t = row.get("nse_category") or "Filing"
    return t[0].upper() + t[1:]


def _rule_classify(row: dict) -> tuple[str | None, str | None]:
    desc = row.get("nse_category", "")
    text = f"{row.get('text', '')}".lower()

    if desc in DESC_DIRECT:
        cat, sub = DESC_DIRECT[desc]
        if cat == "agm_egm" and "postal ballot" in text:
            return "postal_ballot", sub
        if cat == "press_release" and re.search(r"financial results", text):
            return "results", "press_release"
        return cat, sub

    if desc == "Analysts/Institutional Investor Meet/Con. Call Updates":
        if re.search(r"transcript|audio|recording|earnings call|con\.? ?call|conference call", text):
            return "earnings_call", None
        return "investor_meetings", None

    if desc == "Record Date":
        if "dividend" in text:
            return "dividend", "record_date"
        if re.search(r"bonus|split|sub-?division", text):
            return "bonus_split", "record_date"
        return "unclassified", "record_date"

    if desc == "Allotment of Securities" and re.search(r"esop|esos|stock option|employee", text):
        return "unclassified", "esop"

    if desc == "Change in Auditors":
        return ("management_change", "auditor_resign") if "resign" in text else ("unclassified", "auditor")

    if GENERIC_TEXT.search(text.strip()) or len(text.strip()) < 25:
        return None, None

    if re.search(r"results (issued|declared|announced) by|results of (the )?(parent|holding|promoter)", text):
        return "press_release", "parent_results"

    for cat, pattern in KEYWORD_RULES:
        if re.search(pattern, text):
            return cat, None
    if desc in ("Outcome of Board Meeting", "Committee Meeting Updates"):
        return None, None
    if desc == "Press Release":
        return "press_release", None
    return None, None


def _subtype(cat: str, sub: str | None, text: str) -> str | None:
    t = text.lower()
    if cat == "results" and not sub:
        if re.search(r"to consider|intimation|will be held|is scheduled|prior intimation|board meeting", t) and not re.search(r"approved|outcome", t):
            return "scheduled"
        return "filed"
    if cat == "credit_rating":
        if "downgrad" in t:
            return "downgrade"
        if "upgrad" in t:
            return "upgrade"
        if re.search(r"negative|watch", t):
            return "watch_negative"
        return "reaffirm"
    if cat == "fund_raise" and not sub:
        if re.search(r"commercial paper|debenture|\bncds?\b|non[- ]convertible|redemption|bonds?\b", t):
            return "debt"
        if re.search(r"buy-?back", t):
            return "buyback"
        return "equity"
    if cat == "management_change" and not sub:
        senior = bool(SENIOR_ROLE.search(t))
        if "resign" in t or "cessation" in t:
            return "senior_exit" if senior else "exit"
        return "senior_change" if senior else "change"
    if cat == "earnings_call" and not sub:
        return "transcript" if re.search(r"transcript", t) else "notice"
    return sub


BASE_SCORE = {
    "results": 95,
    "M&A": 82,
    "management_change": 72,
    "litigation": 74,
    "fund_raise": 60,
    "credit_rating": 30,
    "pledging": 75,
    "insider_trading": 55,
    "capex": 70,
    "bonus_split": 58,
    "dividend": 42,
    "press_release": 35,
    "earnings_call": 25,
    "investor_meetings": 10,
    "agm_egm": 18,
    "postal_ballot": 18,
    "unclassified": 4,
}

SUB_SCORE = {
    ("results", "scheduled"): 30,
    ("results", "deck"): 50,
    ("results", "press_release"): 80,
    ("results", "newspaper"): 20,
    ("management_change", "senior_exit"): 92,
    ("management_change", "senior_change"): 85,
    ("management_change", "exit"): 62,
    ("management_change", "auditor_resign"): 88,
    ("litigation", "insolvency"): 85,
    ("fund_raise", "debt"): 22,
    ("fund_raise", "buyback"): 78,
    ("fund_raise", "equity"): 72,
    ("credit_rating", "downgrade"): 86,
    ("credit_rating", "watch_negative"): 70,
    ("credit_rating", "upgrade"): 60,
    ("credit_rating", "reaffirm"): 22,
    ("press_release", "parent_results"): 45,
    ("press_release", "order_win"): 58,
    ("press_release", "clarification"): 55,
    ("earnings_call", "transcript"): 40,
    ("M&A", "divestment"): 75,
}


def score(cat: str, sub: str | None) -> int:
    return SUB_SCORE.get((cat, sub), BASE_SCORE.get(cat, 10))


def _llm_batch(rows: list[dict]) -> dict[str, dict]:
    """Classify genuinely ambiguous filings from page 1 of their PDF; one call per 12 filings."""
    out: dict[str, dict] = {}
    todo = []
    for r in rows:
        hit = cache.get_json("cls", r["id"])
        if hit:
            out[r["id"]] = hit
        else:
            todo.append(r)
    if not todo or not llm.available():
        return out

    def first_page(r):
        try:
            return pdf.text(r["url"], max_pages=2, max_chars=2500) if r.get("url") else ""
        except Exception:
            return ""

    with ThreadPoolExecutor(max_workers=6) as pool:
        pages = list(pool.map(first_page, todo))

    cats = ", ".join(CATEGORIES)
    for i in range(0, len(todo), 12):
        chunk = list(zip(todo[i : i + 12], pages[i : i + 12]))
        items = "\n\n".join(
            f"<filing id=\"{r['id']}\">\ncompany: {r['company']}\nexchange label: {r['nse_category']}\nsubject: {r['text']}\nfirst page:\n{p}\n</filing>"
            for r, p in chunk
        )
        prompt = (
            "Classify each Indian stock-exchange filing for a portfolio investor.\n"
            f"Allowed categories: {cats}.\n"
            "materiality: 1 (routine paperwork) to 5 (could move the stock).\n"
            "summary: <= 18 words, concrete facts only (who/what/how much), no filler. Empty if routine.\n"
            'Return JSON: {"items": [{"id": str, "category": str, "materiality": int, "summary": str}]}\n\n' + items
        )
        try:
            res = llm.complete_json(prompt, tier="fast")
            for it in res.get("items", []):
                if it.get("category") in CATEGORIES:
                    out[str(it["id"])] = it
                    cache.set_json("cls", str(it["id"]), it)
        except Exception:
            continue
    return out


def classify(rows: list[dict], allow_llm: bool = True) -> list[dict]:
    ambiguous = []
    for r in rows:
        cat, sub = _rule_classify(r)
        r["subject"] = clean_subject(r)
        if cat is None:
            ambiguous.append(r)
            continue
        r["category"] = cat
        r["subtype"] = _subtype(cat, sub, r["text"])
        r["score"] = score(cat, r["subtype"])
        r["classified_by"] = "rules"

    llm_results = _llm_batch(ambiguous[:40]) if allow_llm else {}
    for r in ambiguous:
        res = llm_results.get(r["id"])
        if res:
            cat = res["category"]
            r["category"] = cat
            r["subtype"] = _subtype(cat, None, f"{r['text']} {res.get('summary', '')}")
            mat = int(res.get("materiality") or 2)
            r["score"] = max(min(score(cat, r["subtype"]), 20 * mat), 5 + 12 * mat)
            r["summary"] = res.get("summary") or None
            r["classified_by"] = "llm"
        else:
            r["category"] = "unclassified"
            r["subtype"] = "unreviewed"
            r["score"] = 20
            r["classified_by"] = "unreviewed"
    return rows
