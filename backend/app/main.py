from datetime import date, datetime, time, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import llm
from .cache import SNAPSHOT_DIR
from .config import CORS_ORIGINS, PORTFOLIO, RESEARCH_DEMO
from .pull import research
from .push import digest as digest_mod
from .push.classify import CATEGORIES
from .push.enrich import enrich
from .sources import prices, screener

app = FastAPI(title="FINN API")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

SYMBOLS = [p["symbol"] for p in PORTFOLIO]
SECTOR = {p["symbol"]: p["sector"] for p in PORTFOLIO}


def _window(window: str, start: date | None, end: date | None, since: datetime | None = None) -> tuple[datetime, datetime]:
    now = datetime.now()
    if since:
        since = since.astimezone().replace(tzinfo=None) if since.tzinfo else since
        return min(since, now - timedelta(hours=1)), now
    if start:
        e = datetime.combine(end or date.today(), time.max)
        return datetime.combine(start, time.min), min(e, now)
    units = {"h": "hours", "d": "days"}
    try:
        n, u = int(window[:-1]), units[window[-1]]
    except (ValueError, KeyError):
        raise HTTPException(400, "window must look like 24h, 3d, 7d")
    return now - timedelta(**{u: n}), now


@app.get("/api/health")
def health():
    return {"ok": True, "llm": llm.available(), "usage": llm.usage()}


@app.get("/api/meta")
def meta():
    return {
        "portfolio": PORTFOLIO,
        "research_demo": RESEARCH_DEMO,
        "categories": CATEGORIES,
        "default_interests": digest_mod.DEFAULT_INTERESTS,
        "llm": llm.available() or any(SNAPSHOT_DIR.glob("llm/*.json")),
    }


@app.get("/api/digest")
async def get_digest(
    window: str = "24h",
    start: date | None = None,
    end: date | None = None,
    since: datetime | None = None,
    interests: str | None = None,
    vol_x: float = Query(2.0, ge=1.0, le=20),
    move_pct: float = Query(4.0, ge=0.5, le=50),
):
    s, e = _window(window, start, end, since)
    ints = [x for x in (interests or "").split(",") if x in CATEGORIES] or None
    d = await run_in_threadpool(digest_mod.build_digest, SYMBOLS, s, e, ints, vol_x, move_pct)
    d["window"]["label"] = "since last visit" if since else window if not start else f"{s.date()} → {e.date()}"
    return d


class StoryIn(BaseModel):
    symbol: str
    company: str | None = None
    category: str
    subtype: str | None = None
    filings: list[dict]


@app.post("/api/enrich")
async def post_enrich(story: StoryIn):
    return await run_in_threadpool(enrich, story.model_dump())


@app.get("/api/portfolio")
async def get_portfolio():
    snap = await run_in_threadpool(prices.snapshot, SYMBOLS)
    out = []
    for s in SYMBOLS:
        p = snap.get(s)
        if not p:
            out.append({"symbol": s, "sector": SECTOR[s]})
            continue
        out.append(
            {
                "symbol": s,
                "sector": SECTOR[s],
                "close": p["close"],
                "date": p["date"],
                "change_pct": p["change_pct"],
                "vol_ratio": p["vol_ratio"],
                "high_52w": p["high_52w"],
                "low_52w": p["low_52w"],
                "spark": p["spark"],
            }
        )
    return {"holdings": out}


@app.get("/api/search")
async def search(q: str):
    if len(q.strip()) < 2:
        return {"results": []}
    try:
        return {"results": await run_in_threadpool(screener.search, q)}
    except Exception:
        return {"results": []}


def _guard(fn, *args):
    try:
        return fn(*args)
    except screener.CompanyNotFound:
        raise HTTPException(404, "Company not found on screener.in")
    except llm.LLMUnavailable:
        raise HTTPException(503, "Add an LLM API key on the server to enable this section.")


@app.get("/api/research/{symbol}")
async def research_overview(symbol: str):
    return await run_in_threadpool(_guard, research.overview, symbol.upper())


@app.get("/api/research/{symbol}/{section}")
async def research_section(symbol: str, section: str):
    fns = {
        "business": research.business,
        "promises": research.promises,
        "bullbear": research.bullbear,
        "governance": research.governance,
    }
    if section not in fns:
        raise HTTPException(404, "Unknown section")
    return await run_in_threadpool(_guard, fns[section], symbol.upper())


class AskIn(BaseModel):
    question: str


@app.post("/api/research/{symbol}/ask")
async def research_ask(symbol: str, body: AskIn):
    return await run_in_threadpool(_guard, research.ask, symbol.upper(), body.question)
