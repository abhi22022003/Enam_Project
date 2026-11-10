"""screener.in: standardised multi-year financials (derived from company filings) and
links to primary documents (annual reports, concall transcripts)."""

import re

from bs4 import BeautifulSoup

from .. import cache
from ..http import client

BASE = "https://www.screener.in"
SECTIONS = ["quarters", "profit-loss", "balance-sheet", "cash-flow", "ratios"]


class CompanyNotFound(LookupError):
    pass


def _num(s: str):
    s = s.strip().replace(",", "").replace("₹", "").replace("Cr.", "").strip()
    if not s:
        return None
    pct = s.endswith("%")
    s = s.rstrip("%").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _row_label(td) -> str:
    label = td.get_text(" ", strip=True)
    label = re.sub(r"\s*\+$", "", label)
    if label.startswith("CFO/EBITDA"):
        return "CFO/EBITDA"
    return label


def _parse_table(section) -> dict | None:
    t = section.select_one("table.data-table") if section else None
    if not t:
        return None
    periods = [th.get_text(strip=True) for th in t.select("thead th")][1:]
    rows = {}
    pdf_links = None
    for tr in t.select("tbody tr"):
        tds = tr.select("td")
        if not tds:
            continue
        label = _row_label(tds[0])
        if label == "Raw PDF":
            pdf_links = [(a.get("href") if (a := td.select_one("a")) else None) for td in tds[1:]]
            continue
        rows[label] = [_num(td.get_text(strip=True)) for td in tds[1:]]
    out = {"periods": periods, "rows": rows}
    if pdf_links:
        out["source_pdfs"] = [BASE + h if h and h.startswith("/") else h for h in pdf_links]
    return out


def _parse_ranges(soup) -> dict:
    out = {}
    for t in soup.select("section#profit-loss table.ranges-table"):
        cells = [x.get_text(" ", strip=True) for x in t.select("tr")]
        if not cells:
            continue
        name, *vals = cells
        out[name] = {k.strip(): _num(v) for k, v in (c.split(":", 1) for c in vals if ":" in c)}
    return out


def _parse_documents(soup) -> dict:
    docs = {"annual_reports": [], "transcripts": [], "presentations": []}
    for a in soup.select("div.annual-reports li a"):
        href = a.get("href")
        if href and href.startswith("http"):
            docs["annual_reports"].append({"title": a.get_text(" ", strip=True), "url": href})
    seen = set()
    for li in soup.select("div.concalls li"):
        when = li.select_one("div")
        label = when.get_text(" ", strip=True) if when else ""
        t = li.select_one('a[title="Raw Transcript"]')
        if t and t.get("href") and t["href"] not in seen:
            seen.add(t["href"])
            docs["transcripts"].append({"period": label, "url": t["href"]})
        for a in li.select("a.button-chip"):
            if a.get_text(strip=True) == "PPT" and a.get("href"):
                docs["presentations"].append({"period": label, "url": a["href"]})
    return docs


def _fetch_html(symbol: str) -> tuple[str, bool]:
    for consolidated in (True, False):
        url = f"{BASE}/company/{symbol}/{'consolidated/' if consolidated else ''}"
        r = client().get(url)
        if r.status_code == 404:
            raise CompanyNotFound(symbol)
        r.raise_for_status()
        html = r.text
        # Some companies have no consolidated numbers; screener then shows an empty quarters table.
        if consolidated and "data-table" in html and "Sales" not in html and "Revenue" not in html:
            continue
        return html, consolidated
    return html, False


def _parse(symbol: str) -> dict:
    html, consolidated = _fetch_html(symbol)
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.select_one("h1")
    about = soup.select_one(".company-profile .about")
    ratios = {}
    for li in soup.select("#top-ratios li"):
        n, v = li.select_one(".name"), li.select_one(".value")
        if n and v:
            ratios[n.get_text(strip=True)] = v.get_text(" ", strip=True)
    tables = {s: _parse_table(soup.select_one(f"section#{s}")) for s in SECTIONS}
    sector = None
    peers = soup.select_one("section#peers")
    if peers:
        crumbs = [a.get_text(strip=True) for a in peers.select("p.sub a")]
        sector = " › ".join(crumbs) if crumbs else None
    return {
        "symbol": symbol,
        "name": h1.get_text(strip=True) if h1 else symbol,
        "about": about.get_text(" ", strip=True) if about else "",
        "sector": sector,
        "consolidated": consolidated,
        "ratios": ratios,
        "tables": tables,
        "growth": _parse_ranges(soup),
        "documents": _parse_documents(soup),
        "url": f"{BASE}/company/{symbol}/{'consolidated/' if consolidated else ''}",
    }


def company(symbol: str) -> dict:
    symbol = symbol.upper().strip()
    key = symbol
    try:
        return cache.cached_json("screener", key, 6 * 3600, lambda: _parse(symbol))
    except CompanyNotFound:
        raise
    except Exception:
        stale = cache.get_json("screener", key)
        if stale:
            return stale
        raise


def search(q: str) -> list[dict]:
    r = client().get(f"{BASE}/api/company/search/", params={"q": q})
    r.raise_for_status()
    out = []
    for item in r.json():
        m = re.match(r"/company/([^/]+)/", item.get("url", ""))
        if m and not m.group(1).isdigit():
            out.append({"symbol": m.group(1), "name": item.get("name")})
    return out[:8]
