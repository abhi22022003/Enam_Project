"""Plain-English titles and one-line gists for story cards.

NSE subjects are written for compliance ("Disclosure under Regulation 30 ...", "Transcript",
"Issue of Securities"). Rules tidy what they can; one batched fast-model call rewrites the rest,
cached per story content so each filing is rewritten once.
"""

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor

from .. import cache, llm

BATCH = 15


def _indian_number(m: re.Match) -> str:
    n = int(m.group().replace(",", ""))
    if n >= 10**7:
        return f"{n / 10**7:.2f}".rstrip("0").rstrip(".") + " crore"
    if n >= 10**5:
        return f"{n / 10**5:.1f}".rstrip("0").rstrip(".") + " lakh"
    return m.group()


def tidy(subject: str) -> str:
    s = " ".join(subject.split())
    s = re.sub(r"\b\d{1,3}(?:,\d{2})+,\d{3}\b|\b\d{6,}\b", _indian_number, s)
    s = re.sub(r",?\s*(at|in) (its|their) meeting held on\b.*$", "", s, flags=re.I)
    s = re.sub(r"\s*(under|pursuant to|in terms of) regulation \d+.*$", "", s, flags=re.I)
    s = re.sub(r"^disclosure\s*$", "", s, flags=re.I)
    s = re.sub(r"\bpursuant to\b", "via", s, flags=re.I)
    s = re.sub(
        r"^(the company|[A-Z][\w&.\- ]*? (limited|ltd\.?))\s+(has|have)\s+"
        r"(informed (the )?exchanges? (regarding|about|that)\s+|filed (with (the )?exchanges? )?)?",
        "",
        s,
        flags=re.I,
    )
    s = s.strip(" ,.-:")
    return s[:1].upper() + s[1:] if s else subject


PROMPT = """Rewrite Indian stock-exchange filing subjects into headlines a retail investor understands at a glance.

For each item return:
- title: at most 9 words, plain English, sentence case (capitalise only the first word, names and acronyms),
  no company name, no regulation numbers, no legal phrasing.
  Say what happened ("Allots ₹8,000 crore of shares to institutions", "Chairman Noel Tata retires"),
  not what the document is ("Disclosure", "Intimation").
- gist: one sentence of at most 20 words adding the most useful concrete fact from DETAILS that the title does
  not already say (amount, price, counterparty, person, reason). Do not restate the title. If there is no such
  fact, return "".

Use ONLY facts present in the item. Keep numbers exactly; you may restate 5,74,25,740 as 5.74 crore.
Never invent amounts, names, reasons or outcomes. Neutral tone: no judgement words (major, rumours, setback,
boost) unless the filing itself uses them. If the exchange asked the company a question, say so; do not imply
the company has answered.

Return JSON: {{"items": [{{"id": "...", "title": "...", "gist": "..."}}]}}

ITEMS:
{items}"""


def _key(story: dict) -> str:
    f = story["filings"][0]
    raw = json.dumps([story["category"], f.get("subject"), (f.get("text") or "")[:500], f.get("nse_summary")])
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _item(story: dict) -> dict:
    f = story["filings"][0]
    details = " ".join(x for x in (f.get("nse_summary"), f.get("text")) if x)
    return {
        "id": _key(story),
        "company": story["company"],
        "category": story["category_label"],
        "subject": f.get("subject"),
        "details": details[:500],
    }


def _rewrite(batch: list[dict]) -> dict[str, dict]:
    try:
        res = llm.complete_json(PROMPT.format(items=json.dumps(batch, ensure_ascii=False)), tier="fast")
    except Exception:
        return {}
    out = {}
    for it in res.get("items", []) if isinstance(res, dict) else []:
        title = (it.get("title") or "").strip()
        if it.get("id") and 3 <= len(title) <= 90:
            out[it["id"]] = {"title": title, "gist": (it.get("gist") or "").strip()}
    for k, v in out.items():
        cache.set_json("headline", k, v)
    return out


def apply(stories: list[dict], allow_llm: bool = True) -> None:
    """Set plain-English `headline` (raw kept in `subject`) and `gist` on non-routine stories."""
    todo = []
    for s in stories:
        s["subject"] = s["filings"][0].get("subject")
        if s["category"] == "results" or s["tier"] == "routine":
            continue
        hit = cache.get_json("headline", _key(s))
        if hit:
            s["headline"], s["gist"] = hit["title"], hit.get("gist") or None
        else:
            s["headline"] = tidy(s["headline"])
            todo.append(s)

    if not todo or not allow_llm or not llm.available():
        return
    items = [_item(s) for s in todo]
    batches = [items[i : i + BATCH] for i in range(0, len(items), BATCH)]
    with ThreadPoolExecutor(4) as pool:
        results: dict[str, dict] = {}
        for r in pool.map(_rewrite, batches):
            results.update(r)
    for s in todo:
        r = results.get(_key(s))
        if r:
            s["headline"], s["gist"] = r["title"], r["gist"] or None
