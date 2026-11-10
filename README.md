# FINN: Financial Investment Agent

A mobile-first agent that reads everything filed about your portfolio so you read three things.

- **Push / Brief**: for any window (24h, 3D, 7D, 30D, custom), every NSE filing across an 18-stock portfolio is classified, grouped into stories, ranked, and the routine ~70% is collapsed. Unusual end-of-day moves (your thresholds) are joined to the filing that likely explains them, or flagged as *unexplained*.
- **Pull / Research**: for **any NSE ticker**, a dossier grounded only in primary sources. The hero view is **Promised vs. Delivered**: every guidance statement from the last five earnings calls, checked against what the company actually reported.

## The point of view

1. **Filter, don't aggregate.** The headline of the app is a number ("7 things matter since yesterday"), not a feed. Routine filings are counted, not shown.
2. **Numbers come from code, words come from the model.** Trajectory, leverage, cash conversion and all "what the numbers say" signals are computed deterministically. The LLM only reads documents (transcripts, filings, annual report) and every claim carries its source.
3. **Every move needs a reason.** A 3× volume day is joined to the filing that explains it. When nothing explains it, that's the alert.
4. **Analyse management, don't summarise them.** Guidance is extracted per call and scored against reported numbers: delivered / partly / missed / tracking / can't verify.

## Architecture

```
frontend/ (Next.js, mobile-first)          backend/ (FastAPI)
  Brief  ── /api/digest ──────────────▶  push/digest    window → fetch → classify → story clustering → rank → alerts
         ── /api/enrich (lazy, per card)▶ push/enrich    results card | management card | one-line summary
  Research ─ /api/research/{sym}  ─────▶  pull/metrics   deterministic sections + rule-based signals
           ─ /api/research/{sym}/{sec} ▶  pull/research  business · promises · bullbear · governance (LLM, cached)
           ─ /api/research/{sym}/ask  ─▶  BM25 over transcript chunks + financial tables → cited answer
  Watch  ── /api/portfolio            ─▶  sources/prices (yfinance EOD)

sources/  nse.py (corporate-announcements API) · screener.py (financials + document links) · pdf.py (PyMuPDF) · prices.py
```

### Cost discipline (the whole demo runs on Gemini's free tier)

| Step | How | Model |
|---|---|---|
| Classify 685 filings / 3 months | NSE's own label + keyword rules handle **84%** at zero cost | none |
| Remaining ambiguous filings ("General Updates") | page 1 of the PDF, **12 filings per call** | fast |
| One-line summaries | NSE's free `voiceSummary` when present; otherwise only for *notable* cards, *on tap* | fast |
| Results card | only the P&L pages are sent (page scorer), validated; retried on the smart model only if the sanity check fails; cross-checked against screener.in | fast → smart |
| Management change | the filing's mandatory "brief profile" annexure, no web scraping | fast |
| Guidance extraction | transcripts pre-filtered to forward-looking paragraphs (~60% fewer tokens), **once per transcript, cached forever** | fast |
| Promised vs. delivered, bull/bear, Q&A | the only cross-document reasoning | smart |

Every LLM response is cached on `(model, prompt)`; `/api/health` exposes a usage ledger.

### Robustness

- Results numbers fall back to screener.in's quarterly table when the filing can't be parsed (labelled on the card).
- `backend/snapshot/` holds a pre-warmed copy of every demo path (`uv run python -m scripts.warm`), used only when a live source fails, e.g. NSE blocking cloud IPs.

## Run locally

```bash
# backend
cd backend
cp .env.example .env            # add GEMINI_API_KEY (free: https://aistudio.google.com/apikey)
uv sync
uv run uvicorn app.main:app --reload --port 8000

# frontend
cd frontend
npm install
npm run dev                      # http://localhost:3000, proxies /api to :8000
```

Open on a phone on the same Wi-Fi: `npm run dev -- -H 0.0.0.0` and visit `http://<laptop-ip>:3000`.

## Deploy

- Backend: Render (`render.yaml`, Docker) with `GEMINI_API_KEY` set.
- Frontend: Vercel, root `frontend/`, env `BACKEND_URL=https://<render-url>` (and `NEXT_PUBLIC_API_URL` to the same for long research calls).

## Portfolio

RELIANCE, HDFCBANK, ICICIBANK, BAJFINANCE, TCS, INFY, PERSISTENT, ITC, HINDUNILVR, TITAN, TRENT, MARUTI, SUNPHARMA, LT, DIXON, POLYCAB, ETERNAL, DEEPAKNTR. Research demo outside the portfolio: PIDILITIND, KAYNES, CDSL, ASTRAL (any NSE ticker works).
