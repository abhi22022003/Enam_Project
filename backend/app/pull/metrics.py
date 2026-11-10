"""Deterministic research sections computed from the standardised financial tables.
Numbers come from code, never from the model."""


def _row(table: dict | None, *names: str) -> list | None:
    if not table:
        return None
    for n in names:
        if n in table["rows"]:
            return table["rows"][n]
    return None


def _cagr(series: list, years: int) -> float | None:
    vals = [v for v in series if v is not None]
    if len(vals) < years + 1:
        return None
    a, b = vals[-years - 1], vals[-1]
    if a is None or b is None or a <= 0 or b <= 0:
        return None
    return round(((b / a) ** (1 / years) - 1) * 100, 1)


def _safe_div(a, b, scale=1.0):
    if a is None or b in (None, 0):
        return None
    return round(a / b * scale, 2)


def _annual(co: dict) -> dict:
    pl = co["tables"].get("profit-loss")
    periods = pl["periods"] if pl else []
    keep = [i for i, p in enumerate(periods) if p != "TTM"]
    keep = keep[-8:]
    pick = lambda xs: [xs[i] for i in keep] if xs else None  # noqa: E731
    return {
        "periods": [periods[i] for i in keep],
        "revenue": pick(_row(pl, "Sales", "Revenue")),
        "ebitda": pick(_row(pl, "Operating Profit")),
        "opm": pick(_row(pl, "OPM %")),
        "pbt": pick(_row(pl, "Profit before tax")),
        "pat": pick(_row(pl, "Net Profit")),
        "eps": pick(_row(pl, "EPS in Rs")),
        "financing_profit": pick(_row(pl, "Financing Profit")),
        "ttm": {
            "revenue": (_row(pl, "Sales", "Revenue") or [None])[-1] if periods and periods[-1] == "TTM" else None,
            "pat": (_row(pl, "Net Profit") or [None])[-1] if periods and periods[-1] == "TTM" else None,
        },
    }


def _quarterly(co: dict) -> dict:
    q = co["tables"].get("quarters")
    if not q:
        return {"periods": []}
    n = 9
    sl = lambda xs: xs[-n:] if xs else None  # noqa: E731
    return {
        "periods": q["periods"][-n:],
        "revenue": sl(_row(q, "Sales", "Revenue")),
        "yoy_growth": sl(_row(q, "YoY Sales growth")),
        "ebitda": sl(_row(q, "Operating Profit")),
        "opm": sl(_row(q, "OPM %")),
        "pbt": sl(_row(q, "Profit before tax")),
        "pat": sl(_row(q, "Net Profit")),
        "source_pdfs": (q.get("source_pdfs") or [])[-n:],
    }


def _balance(co: dict) -> dict:
    bs = co["tables"].get("balance-sheet")
    ratios = co["tables"].get("ratios")
    periods = (bs or {}).get("periods", [])[-6:]
    eq = _row(bs, "Equity Capital") or []
    res = _row(bs, "Reserves") or []
    debt = _row(bs, "Borrowings") or []
    networth = [(a or 0) + (b or 0) for a, b in zip(eq, res)][-6:]
    debt = debt[-6:]
    de = [_safe_div(d, n) for d, n in zip(debt, networth)]
    rp = (ratios or {}).get("periods", [])[-6:]
    return {
        "periods": periods,
        "net_worth": networth,
        "borrowings": debt,
        "debt_to_equity": de,
        "total_assets": (_row(bs, "Total Assets") or [])[-6:],
        "wc_periods": rp,
        "debtor_days": (_row(ratios, "Debtor Days") or [])[-6:],
        "inventory_days": (_row(ratios, "Inventory Days") or [])[-6:],
        "payable_days": (_row(ratios, "Days Payable") or [])[-6:],
        "cash_conversion_cycle": (_row(ratios, "Cash Conversion Cycle") or [])[-6:],
        "roce": (_row(ratios, "ROCE %") or [])[-6:],
        "roe": (_row(ratios, "ROE %") or [])[-6:],
    }


def _cash(co: dict, annual: dict) -> dict:
    cf = co["tables"].get("cash-flow")
    periods = (cf or {}).get("periods", [])[-6:]
    cfo = (_row(cf, "Cash from Operating Activity") or [])[-6:]
    fcf = (_row(cf, "Free Cash Flow") or [])[-6:]
    pat_by_period = dict(zip(annual["periods"], annual["pat"] or []))
    pat = [pat_by_period.get(p) for p in periods]
    conv = [_safe_div(c, p, 100) for c, p in zip(cfo, pat)]
    tot_cfo = sum(c for c in cfo if c is not None)
    tot_pat = sum(p for p in pat if p is not None)
    return {
        "periods": periods,
        "cfo": cfo,
        "fcf": fcf,
        "pat": pat,
        "cfo_to_pat_pct": conv,
        "cumulative_conversion_pct": round(tot_cfo / tot_pat * 100) if tot_pat > 0 else None,
        "cfo_ebitda_pct": (_row(cf, "CFO/EBITDA") or [])[-6:],
    }


def _signals(co: dict, annual: dict, quarterly: dict, bal: dict, cash: dict, lender: bool) -> list[dict]:
    """Rule-based observations; each carries the numbers that triggered it."""
    out = []
    rev, pat, opm = annual["revenue"] or [], annual["pat"] or [], annual["opm"] or []
    r3, p3 = _cagr(rev, 3), _cagr(pat, 3)
    if r3 is not None:
        out.append({"area": "trajectory", "tone": "good" if r3 >= 12 else "bad" if r3 < 5 else "neutral",
                    "text": f"Revenue compounded {r3}% a year over 3 years"})
    if r3 is not None and p3 is not None and abs(p3 - r3) >= 4:
        out.append({"area": "trajectory", "tone": "good" if p3 > r3 else "bad",
                    "text": f"Profit grew {'faster' if p3 > r3 else 'slower'} than revenue ({p3}% vs {r3}% 3y CAGR): margins {'expanding' if p3 > r3 else 'compressing'}"})
    if not lender and len([x for x in opm if x is not None]) >= 4:
        o = [x for x in opm if x is not None]
        d = o[-1] - o[-4]
        if abs(d) >= 2:
            out.append({"area": "trajectory", "tone": "good" if d > 0 else "bad",
                        "text": f"Operating margin {'up' if d > 0 else 'down'} {abs(d):.0f} pts in 3 years ({o[-4]:.0f}% → {o[-1]:.0f}%)"})
    q_opm = [x for x in (quarterly.get("opm") or []) if x is not None]
    if not lender and len(q_opm) >= 5:
        d = q_opm[-1] - q_opm[-5]
        if abs(d) >= 2:
            out.append({"area": "trajectory", "tone": "good" if d > 0 else "bad",
                        "text": f"Latest-quarter margin {q_opm[-1]:.0f}% vs {q_opm[-5]:.0f}% a year ago"})
    de = [x for x in bal["debt_to_equity"] if x is not None]
    if de and not lender:
        if de[-1] >= 1:
            out.append({"area": "balance_sheet", "tone": "bad", "text": f"Leveraged: debt is {de[-1]:.1f}× equity"})
        elif de[-1] <= 0.1:
            out.append({"area": "balance_sheet", "tone": "good", "text": f"Practically debt-free (D/E {de[-1]:.2f})"})
        if len(de) >= 3 and de[-1] - de[-3] >= 0.3:
            out.append({"area": "balance_sheet", "tone": "bad", "text": f"Leverage rising: D/E {de[-3]:.2f} → {de[-1]:.2f} in 2 years"})
    ccc = [x for x in bal["cash_conversion_cycle"] if x is not None]
    if len(ccc) >= 3 and not lender:
        d = ccc[-1] - ccc[-3]
        if abs(d) >= 15:
            out.append({"area": "balance_sheet", "tone": "bad" if d > 0 else "good",
                        "text": f"Cash conversion cycle {'lengthened' if d > 0 else 'shortened'} {abs(d):.0f} days in 2 years ({ccc[-3]:.0f} → {ccc[-1]:.0f})"})
    conv = cash["cumulative_conversion_pct"]
    if conv is not None and not lender:
        tone = "good" if conv >= 90 else "bad" if conv < 70 else "neutral"
        out.append({"area": "cash", "tone": tone,
                    "text": f"{conv}% of reported profit turned into operating cash over {len(cash['periods'])} years"})
    neg_fcf = sum(1 for x in cash["fcf"] if x is not None and x < 0)
    if neg_fcf >= 2 and not lender:
        out.append({"area": "cash", "tone": "bad", "text": f"Free cash flow negative in {neg_fcf} of last {len(cash['fcf'])} years"})
    roce = [x for x in bal["roce"] if x is not None]
    if roce:
        out.append({"area": "returns", "tone": "good" if roce[-1] >= 20 else "bad" if roce[-1] < 10 else "neutral",
                    "text": f"ROCE {roce[-1]:.0f}%" + (f" (from {roce[0]:.0f}% {len(roce) - 1}y ago)" if len(roce) > 1 else "")})
    return out


def overview(co: dict) -> dict:
    lender = "Financing Profit" in ((co["tables"].get("profit-loss") or {}).get("rows") or {})
    annual = _annual(co)
    quarterly = _quarterly(co)
    bal = _balance(co)
    cash = _cash(co, annual)
    return {
        "symbol": co["symbol"],
        "name": co["name"],
        "about": co["about"],
        "sector": co["sector"],
        "basis": "consolidated" if co["consolidated"] else "standalone",
        "is_lender": lender,
        "ratios": co["ratios"],
        "growth": co["growth"],
        "annual": annual,
        "quarterly": quarterly,
        "balance_sheet": bal,
        "cash": cash,
        "signals": _signals(co, annual, quarterly, bal, cash, lender),
        "documents": {
            "transcripts": co["documents"]["transcripts"][:8],
            "annual_reports": co["documents"]["annual_reports"][:3],
        },
        "source": co["url"],
    }
