import re
from concurrent.futures import ThreadPoolExecutor

from .. import cache, llm
from ..sources import pdf

FORWARD = re.compile(
    r"guid|expect|outlook|target|aspir|going forward|next (year|quarter|few)|fy ?'?2\d|fy\d\d|h[12]\b|second half|"
    r"margin (band|range)|range of|double[- ]digit|capex|we will|we should|confident|trajectory|sustain|run[- ]rate|"
    r"by (the )?end of|visibility|pipeline|deal wins|order book|commission|ramp|reiterat|maintain|achiev|deliver|"
    r"growth of|grow (at|by)|\d+\s?(%|percent|bps|basis points)",
    re.I,
)


def _chunks(text: str, size: int = 900) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n|(?<=[.?!])\n(?=[A-Z][a-zA-Z .]{2,40}:)", text) if p.strip()]
    out, buf = [], ""
    for p in paras:
        p = re.sub(r"\s+", " ", p)
        if len(buf) + len(p) > size and buf:
            out.append(buf)
            buf = ""
        buf = f"{buf} {p}".strip()
    if buf:
        out.append(buf)
    return out


def transcript_text(url: str) -> str:
    pages = pdf.pages(url, max_pages=60)
    return "\n\n".join(pages)


def forward_looking_excerpt(text: str, max_chars: int = 20000) -> str:
    """Keep only chunks with forward-looking or quantitative language (plus the opening remarks)."""
    chunks = _chunks(text)
    head = " ".join(chunks[:3])[:2500]
    keep = [c for c in chunks[3:] if len(FORWARD.findall(c)) >= 2]
    body = "\n---\n".join(keep)
    return (head + "\n---\n" + body)[:max_chars]


EXTRACT_PROMPT = """You are reading an Indian listed company's earnings-call transcript (excerpts with forward-looking language).
Extract ONLY what is in the text. Do not use outside knowledge.

Return JSON:
{{"quarter_discussed": "e.g. Q2 FY27 (quarter whose results are discussed)",
  "guidance": [{{"topic": "revenue growth|margin|capex|volume|order book|debt|other",
                 "statement": "what management committed to / expects, <= 25 words, keep numbers",
                 "quote": "short verbatim quote (<= 30 words)",
                 "horizon": "e.g. FY27, next quarter, medium term",
                 "specificity": "numeric|directional"}}],
  "reported": [{{"metric": str, "value": "as stated by management for the quarter, with units"}}],
  "analyst_concerns": ["<= 15 words each, the issues analysts pushed on"],
  "tone": "<= 15 words on management's confidence / hedging"}}
Only include guidance that is a forward-looking commitment or expectation (max 8, most important first).

TRANSCRIPT ({period}):
{text}"""


def extract(period: str, url: str) -> dict:
    hit = cache.get_json("guidance", url)
    if hit:
        return hit
    text = forward_looking_excerpt(transcript_text(url))
    res = llm.complete_json(EXTRACT_PROMPT.format(period=period, text=text), tier="fast")
    res["call_period"] = period
    res["url"] = url
    cache.set_json("guidance", url, res)
    return res


def extract_many(transcripts: list[dict], n: int = 5) -> list[dict]:
    todo = transcripts[:n]

    def run(t):
        try:
            return extract(t["period"], t["url"])
        except Exception as e:
            return {"call_period": t["period"], "url": t["url"], "error": str(e)[:200]}

    with ThreadPoolExecutor(max_workers=3) as pool:
        return list(pool.map(run, todo))


def search_chunks(transcripts: list[dict], n: int = 4) -> list[dict]:
    """All transcript chunks (for the Q&A retriever), tagged with their source."""
    out = []
    for t in transcripts[:n]:
        try:
            text = transcript_text(t["url"])
        except Exception:
            continue
        for i, c in enumerate(_chunks(text, size=1100)):
            out.append({"source": f"{t['period']} call", "url": t["url"], "chunk": i, "text": c})
    return out
