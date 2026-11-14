"""Pull-side research. Grounded only in primary documents (transcripts, annual report) and the
standardised financial statements derived from company filings."""

import json
import re

from rank_bm25 import BM25Okapi

from .. import cache, llm
from ..sources import pdf, screener
from . import metrics, transcripts

GROUNDING = (
    "Use ONLY the provided sources. Never use outside knowledge about this company, news, or broker views. "
    "If the sources do not support a claim, leave it out."
)


def _company(symbol: str) -> dict:
    return screener.company(symbol)


def overview(symbol: str) -> dict:
    return metrics.overview(_company(symbol))


def _quarter_table(ov: dict) -> str:
    q = ov["quarterly"]
    lines = ["period | revenue (₹ Cr) | YoY revenue % | operating profit | OPM % | PAT"]
    for i, p in enumerate(q["periods"]):
        g = lambda k: (q.get(k) or [None] * 99)[i]  # noqa: E731
        lines.append(f"{p} | {g('revenue')} | {g('yoy_growth')} | {g('ebitda')} | {g('opm')} | {g('pat')}")
    return "\n".join(lines)


def _annual_table(ov: dict) -> str:
    a = ov["annual"]
    lines = ["year | revenue | OPM % | PAT"]
    for i, p in enumerate(a["periods"]):
        g = lambda k: (a.get(k) or [None] * 99)[i]  # noqa: E731
        lines.append(f"{p} | {g('revenue')} | {g('opm')} | {g('pat')}")
    return "\n".join(lines)


# ------------------------------------------------------------ business snapshot

BUSINESS_PROMPT = """Write a business snapshot of {name} for an investor, from the earnings-call opening remarks below.
{grounding}
Return JSON:
{{"one_liner": "what the company does and how it makes money, <= 25 words",
  "segments": [{{"name": str, "share": "share of revenue if stated, else null", "latest": "latest growth/performance as stated, <= 14 words"}}],
  "drivers": ["<= 12 words each: what is driving the business right now (max 4)"],
  "source": "{period} earnings call"}}

OPENING REMARKS ({period} call):
{text}"""


def business(symbol: str) -> dict:
    co = _company(symbol)
    ts = co["documents"]["transcripts"]
    if not ts:
        return {"error": "No earnings-call transcript available on screener.in for this company."}
    hit = cache.get_json("business", ts[0]["url"])
    if hit:
        return hit
    for latest in ts[:3]:
        try:
            text = transcripts.transcript_text(latest["url"])
        except Exception:
            continue
        if text.strip():
            break
    else:
        return {"error": "Could not read the latest earnings-call transcripts."}
    key = ts[0]["url"]
    res = llm.complete_json(
        BUSINESS_PROMPT.format(name=co["name"], grounding=GROUNDING, period=latest["period"], text=text[:14000]),
        tier="fast",
    )
    res["source_url"] = latest["url"]
    cache.set_json("business", key, res)
    return res


# ------------------------------------------------------------ promised vs delivered

PROMISES_PROMPT = """You are an analyst checking management credibility for {name}.
{grounding}

Below are guidance statements extracted from the last few earnings calls (oldest first), management's own
reported outcomes, and the actual reported quarterly financials (₹ crore, {basis}).

For each material promise made in the EARLIER calls, judge whether later results delivered it.
Use the quarterly table for revenue / margin / profit claims; use management's later "reported" statements for
metrics not in the table (e.g. constant-currency growth, volumes, order book). If neither shows the outcome, use
"unverifiable". If the promised horizon has not yet ended, use "too_early" but say how it is tracking.

Return JSON:
{{"scorecard": [{{"promise": "<= 20 words, with the number", "made_in": "call period",
                 "quote": "verbatim from the guidance item",
                 "outcome": "<= 25 words with actual numbers and the period they come from",
                 "verdict": "delivered|partly|missed|too_early|unverifiable",
                 "evidence_source": "e.g. Quarterly results Sep 2026 / Q2 FY27 call"}}],
  "credibility": {{"delivered": int, "partly": int, "missed": int, "summary": "<= 30 words: does this management under- or over-promise? cite the pattern"}},
  "narrative_vs_numbers": ["<= 25 words each: where management's story and the reported numbers diverge or agree (max 4)"]}}
Max 8 scorecard rows; prioritise numeric promises on revenue growth, margins, capex.

GUIDANCE BY CALL:
{guidance}

QUARTERLY FINANCIALS:
{quarters}

ANNUAL FINANCIALS:
{annual}"""


def _guidance_digest(extracted: list[dict]) -> str:
    parts = []
    for e in reversed(extracted):
        if e.get("error"):
            continue
        g = [{k: x.get(k) for k in ("topic", "statement", "quote", "horizon")} for x in e.get("guidance", [])]
        parts.append(
            json.dumps(
                {
                    "call": e.get("call_period"),
                    "quarter_discussed": e.get("quarter_discussed"),
                    "guidance": g,
                    "reported": e.get("reported", [])[:8],
                },
                ensure_ascii=False,
            )
        )
    return "\n".join(parts)


def promises(symbol: str) -> dict:
    co = _company(symbol)
    ov = metrics.overview(co)
    ts = co["documents"]["transcripts"]
    if len(ts) < 2:
        return {"error": "Need at least two earnings-call transcripts to compare promises with delivery."}
    extracted = transcripts.extract_many(ts, n=5)
    ok = [e for e in extracted if not e.get("error")]
    if len(ok) < 2:
        return {"error": "Could not read enough transcripts.", "calls": extracted}
    key = json.dumps([symbol, [e["url"] for e in ok], ov["quarterly"]["periods"][-1:]])
    hit = cache.get_json("promises", key)
    if hit:
        return hit
    res = llm.complete_json(
        PROMISES_PROMPT.format(
            name=co["name"],
            grounding=GROUNDING,
            basis=ov["basis"],
            guidance=_guidance_digest(ok),
            quarters=_quarter_table(ov),
            annual=_annual_table(ov),
        ),
        tier="smart",
        max_tokens=6000,
    )
    res["calls"] = [
        {
            "period": e.get("call_period"),
            "quarter_discussed": e.get("quarter_discussed"),
            "url": e.get("url"),
            "tone": e.get("tone"),
            "guidance": e.get("guidance", []),
            "analyst_concerns": e.get("analyst_concerns", []),
        }
        for e in ok
    ]
    cache.set_json("promises", key, res)
    return res


# ------------------------------------------------------------ bull vs bear

BULLBEAR_PROMPT = """Write a tight bull and bear case for {name} from the evidence below.
{grounding}
Each point must cite a specific number or a management statement from the evidence. No generic statements
("strong brand", "experienced management") unless the evidence shows it with numbers.

Return JSON:
{{"bull": [{{"point": "<= 22 words", "evidence": "the number/quote it rests on"}}],
  "bear": [{{"point": "<= 22 words", "evidence": "the number/quote it rests on"}}],
  "watch_next": ["<= 15 words each: the 2-3 things next quarter's results/call will prove or disprove"]}}
3 points each side.

COMPUTED SIGNALS: {signals}
KEY RATIOS: {ratios}
QUARTERLY: {quarters}
ANNUAL: {annual}
CASH CONVERSION: {cash}
MANAGEMENT GUIDANCE & ANALYST CONCERNS (latest calls): {guidance}"""


def bullbear(symbol: str) -> dict:
    co = _company(symbol)
    ov = metrics.overview(co)
    extracted = transcripts.extract_many(co["documents"]["transcripts"], n=3) if co["documents"]["transcripts"] else []
    g = [
        {"call": e.get("call_period"), "guidance": [x.get("statement") for x in e.get("guidance", [])],
         "analyst_concerns": e.get("analyst_concerns", []), "tone": e.get("tone")}
        for e in extracted if not e.get("error")
    ]
    payload = BULLBEAR_PROMPT.format(
        name=co["name"],
        grounding=GROUNDING,
        signals=json.dumps([s["text"] for s in ov["signals"]]),
        ratios=json.dumps(ov["ratios"], ensure_ascii=False),
        quarters=_quarter_table(ov),
        annual=_annual_table(ov),
        cash=json.dumps({k: ov["cash"][k] for k in ("periods", "cfo", "fcf", "cfo_to_pat_pct")}),
        guidance=json.dumps(g, ensure_ascii=False),
    )
    hit = cache.get_json("bullbear", payload)
    if hit:
        return hit
    res = llm.complete_json(payload, tier="smart")
    cache.set_json("bullbear", payload, res)
    return res


# ------------------------------------------------------------ annual report: governance scan

AR_TERMS = {
    "contingent": re.compile(r"contingent liabilit", re.I),
    "related_party": re.compile(r"related party transactions?", re.I),
    "audit": re.compile(r"key audit matter|qualified opinion|basis for qualified|emphasis of matter|material uncertainty", re.I),
}

GOV_PROMPT = """From these annual-report pages of {name}, extract governance and balance-sheet red flags for an investor.
{grounding}
Return JSON:
{{"auditor": {{"opinion": "unmodified|qualified|adverse|disclaimer|unknown", "key_audit_matters": ["<= 12 words each"], "emphasis_or_uncertainty": str|null}},
  "contingent_liabilities": {{"total": "amount with unit if stated, else null", "largest_items": ["<= 15 words each"]}},
  "related_party": ["<= 18 words each: notable related-party transactions with amounts (max 4)"],
  "flags": [{{"severity": "high|medium|low", "text": "<= 20 words"}}]}}

PAGES ({title}):
{text}"""


def governance(symbol: str) -> dict:
    co = _company(symbol)
    ars = co["documents"]["annual_reports"]
    if not ars:
        return {"error": "No annual report link available."}
    ar = ars[0]
    hit = cache.get_json("governance", ar["url"])
    if hit:
        return hit
    pages = pdf.pages(ar["url"])
    picked: list[int] = []
    for name, pat in AR_TERMS.items():
        hits = [i for i, t in enumerate(pages) if pat.search(t)]
        hits.sort(key=lambda i: -len(pat.findall(pages[i])))
        picked += hits[:3 if name != "audit" else 4]
    picked = sorted(set(picked))[:10]
    text = "\n\n".join(f"[page {i + 1}]\n{pages[i][:3500]}" for i in picked)
    res = llm.complete_json(GOV_PROMPT.format(name=co["name"], grounding=GROUNDING, title=ar["title"], text=text), tier="fast")
    res["source"] = {"title": ar["title"], "url": ar["url"], "pages": [i + 1 for i in picked], "total_pages": len(pages)}
    cache.set_json("governance", ar["url"], res)
    return res


# ------------------------------------------------------------ ask (grounded Q&A)

ASK_PROMPT = """Answer the investor's question about {name} using ONLY the numbered sources.
{grounding}
Cite sources inline like [1], [3]. If the sources don't contain the answer, say exactly what is missing.
Be concise: <= 120 words, lead with the direct answer, numbers over adjectives.

QUESTION: {question}

SOURCES:
{sources}"""

_tok = re.compile(r"[a-z0-9%]+")


def _tokens(s: str) -> list[str]:
    return _tok.findall(s.lower())


def ask(symbol: str, question: str) -> dict:
    co = _company(symbol)
    ov = metrics.overview(co)
    chunks = transcripts.search_chunks(co["documents"]["transcripts"], n=4)
    fin_docs = [
        {"source": "Quarterly financials (screener.in, from filings)", "url": co["url"], "text": _quarter_table(ov)},
        {"source": "Annual financials (screener.in, from filings)", "url": co["url"], "text": _annual_table(ov)},
        {"source": "Computed signals", "url": co["url"], "text": "; ".join(s["text"] for s in ov["signals"])},
    ]
    corpus = fin_docs + chunks
    bm25 = BM25Okapi([_tokens(d["text"]) for d in corpus])
    scores = bm25.get_scores(_tokens(question))
    ranked = sorted(range(len(corpus)), key=lambda i: -scores[i])
    top = [corpus[i] for i in ranked[:7]]
    for d in fin_docs[:1]:
        if d not in top:
            top.append(d)
    sources = "\n\n".join(f"[{i + 1}] ({d['source']}) {d['text'][:1600]}" for i, d in enumerate(top))
    answer = llm.complete(
        ASK_PROMPT.format(name=co["name"], grounding=GROUNDING, question=question, sources=sources),
        tier="smart",
        max_tokens=800,
    )
    return {
        "answer": answer.strip(),
        "sources": [{"n": i + 1, "label": d["source"], "url": d["url"], "snippet": d["text"][:280]} for i, d in enumerate(top)],
    }
