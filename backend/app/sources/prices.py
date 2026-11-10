import math

import pandas as pd
import yfinance as yf

from .. import cache

AVG_WINDOW = 20


def _download(symbols: list[str]) -> dict:
    tickers = [f"{s}.NS" for s in symbols]
    df = yf.download(
        tickers, period="1y", interval="1d", group_by="ticker", auto_adjust=False, progress=False, threads=True
    )
    out = {}
    for s, t in zip(symbols, tickers):
        try:
            sub = df[t] if len(tickers) > 1 else df
            sub = sub[["Close", "Volume"]].dropna()
        except KeyError:
            continue
        if sub.empty:
            continue
        out[s] = [
            {"date": idx.strftime("%Y-%m-%d"), "close": float(row.Close), "volume": float(row.Volume)}
            for idx, row in sub.iterrows()
        ]
    return out


def history(symbols: list[str]) -> dict[str, list[dict]]:
    key = ",".join(sorted(symbols))
    try:
        return cache.cached_json("prices", key, 3600, lambda: _download(symbols))
    except Exception:
        return cache.get_json("prices", key) or {}


def day_metrics(series: list[dict]) -> list[dict]:
    """Per-day change % and volume vs trailing average (excluding that day)."""
    if not series:
        return []
    df = pd.DataFrame(series)
    df["change_pct"] = df["close"].pct_change() * 100
    df["avg_vol"] = df["volume"].shift(1).rolling(AVG_WINDOW, min_periods=10).mean()
    df["vol_ratio"] = df["volume"] / df["avg_vol"]
    df["high_52w"] = df["close"].cummax()
    df["low_52w"] = df["close"].cummin()
    rows = []
    for r in df.itertuples():
        rows.append(
            {
                "date": r.date,
                "close": round(r.close, 2),
                "volume": int(r.volume),
                "change_pct": None if math.isnan(r.change_pct) else round(r.change_pct, 2),
                "avg_vol": None if math.isnan(r.avg_vol) else int(r.avg_vol),
                "vol_ratio": None if math.isnan(r.vol_ratio) else round(r.vol_ratio, 2),
                "high_52w": round(r.high_52w, 2),
                "low_52w": round(r.low_52w, 2),
            }
        )
    return rows


def snapshot(symbols: list[str]) -> dict[str, dict]:
    hist = history(symbols)
    out = {}
    for s in symbols:
        days = day_metrics(hist.get(s, []))
        if not days:
            continue
        last = days[-1]
        out[s] = {
            **last,
            "spark": [d["close"] for d in days[-30:]],
            "days": days[-60:],
        }
    return out
