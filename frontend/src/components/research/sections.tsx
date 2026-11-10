"use client";

import { useEffect, useState } from "react";
import { api, ApiError, BullBear, Business, Governance, Overview, Promises } from "@/lib/api";
import { crore } from "@/lib/format";
import { Bars, ErrorNote, Skeleton, Tag } from "../ui";

export function useSection<T>(symbol: string, section: string, enabled: boolean) {
  const [nonce, setNonce] = useState(0);
  const key = `${symbol}|${section}|${nonce}`;
  const [res, setRes] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .section<T & { error?: string }>(symbol, section)
      .then((d) => alive && setRes(d?.error ? { key, error: d.error } : { key, data: d }))
      .catch((e: ApiError) => alive && setRes({ key, error: e.message }));
    return () => {
      alive = false;
    };
  }, [key, symbol, section, enabled]);
  const cur = res?.key === key ? res : null;
  return { data: cur?.data ?? null, error: cur?.error ?? null, retry: () => setNonce((n) => n + 1) };
}

function Loading({ label }: { label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-faint">{label}</p>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function H({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-faint">{children}</h3>
      {right}
    </div>
  );
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  delivered: { label: "Delivered", cls: "bg-up/15 text-up" },
  partly: { label: "Partly", cls: "bg-warn/15 text-warn" },
  missed: { label: "Missed", cls: "bg-down/15 text-down" },
  too_early: { label: "Tracking", cls: "bg-accent/15 text-accent" },
  unverifiable: { label: "Can't verify", cls: "bg-white/5 text-muted" },
};

export function PromisesSection({ symbol }: { symbol: string }) {
  const { data, error, retry } = useSection<Promises>(symbol, "promises", true);
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <ErrorNote message={error} onRetry={retry} />;
  if (!data) return <Loading label="Reading the last 5 earnings calls and matching every promise to reported numbers… (first run ~30s, then cached)" />;
  const c = data.credibility;
  const total = c.delivered + c.partly + c.missed;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-panel-2 p-3.5">
        <div className="flex items-center gap-3">
          <div className="num text-[28px] font-semibold leading-none">
            {c.delivered}
            <span className="text-[16px] text-faint">/{total || "–"}</span>
          </div>
          <div className="text-[11px] leading-tight text-muted">
            checkable promises
            <br />
            delivered in full
          </div>
          <div className="ml-auto flex h-2 w-24 overflow-hidden rounded-full bg-white/5">
            <div className="bg-up" style={{ width: `${(c.delivered / (total || 1)) * 100}%` }} />
            <div className="bg-warn" style={{ width: `${(c.partly / (total || 1)) * 100}%` }} />
            <div className="bg-down" style={{ width: `${(c.missed / (total || 1)) * 100}%` }} />
          </div>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-snug text-ink/90">{c.summary}</p>
      </div>

      <div className="space-y-2">
        {data.scorecard.map((r, i) => {
          const v = VERDICT[r.verdict] ?? VERDICT.unverifiable;
          return (
            <button key={i} onClick={() => setOpen(open === i ? null : i)} className="block w-full rounded-xl border border-line bg-panel p-3 text-left">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-faint">Promised in {r.made_in}</div>
                  <div className="text-[13px] font-medium leading-snug">{r.promise}</div>
                </div>
                <Tag className={v.cls}>{v.label}</Tag>
              </div>
              <div className="mt-1.5 text-[12px] leading-snug text-muted">
                <span className="text-faint">Actual: </span>
                {r.outcome}
              </div>
              {open === i && (
                <div className="fade-in mt-2 space-y-1 border-t border-line pt-2 text-[11.5px]">
                  <p className="italic text-ink/80">“{r.quote}”</p>
                  <p className="text-faint">Evidence: {r.evidence_source}</p>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {data.narrative_vs_numbers?.length > 0 && (
        <div>
          <H>Story vs numbers</H>
          <ul className="space-y-1.5">
            {data.narrative_vs_numbers.map((n, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ink/90">
                <span className="text-accent">›</span>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <H>What analysts pushed on</H>
        <div className="space-y-2">
          {data.calls.slice(0, 2).map((c) => (
            <div key={c.url} className="text-[12px]">
              <a href={c.url} target="_blank" rel="noreferrer" className="text-[10px] text-faint underline decoration-dotted">
                {c.quarter_discussed || c.period} call ↗
              </a>
              <ul className="mt-1 space-y-0.5 text-muted">
                {c.analyst_concerns.slice(0, 3).map((a) => (
                  <li key={a}>· {a}</li>
                ))}
              </ul>
              {c.tone && <p className="mt-1 text-[11px] text-faint">Tone: {c.tone}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BusinessSection({ symbol, ov }: { symbol: string; ov: Overview }) {
  const { data, error, retry } = useSection<Business>(symbol, "business", true);
  const ttm = ov.annual.ttm;
  const keys = ["Market Cap", "Stock P/E", "ROCE", "ROE", "Dividend Yield", "Book Value"];
  return (
    <div className="space-y-4">
      {error ? (
        <ErrorNote message={error} onRetry={retry} />
      ) : !data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="space-y-3">
          <p className="text-[14px] leading-snug">{data.one_liner}</p>
          {data.segments?.length > 0 && (
            <div className="divide-y divide-line rounded-xl border border-line bg-panel">
              {data.segments.map((s) => (
                <div key={s.name} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium">{s.name}</div>
                    <div className="text-[11.5px] text-muted">{s.latest}</div>
                  </div>
                  {s.share && <span className="num text-[12px] text-accent">{s.share}</span>}
                </div>
              ))}
            </div>
          )}
          {data.drivers?.length > 0 && (
            <ul className="space-y-1">
              {data.drivers.map((d) => (
                <li key={d} className="text-[12px] text-muted">
                  · {d}
                </li>
              ))}
            </ul>
          )}
          <a href={data.source_url} target="_blank" rel="noreferrer" className="text-[10px] text-faint underline decoration-dotted">
            Source: {data.source} transcript ↗
          </a>
        </div>
      )}
      <div>
        <H>Financial snapshot</H>
        <div className="grid grid-cols-3 gap-2">
          {ttm.revenue != null && <Stat label="Revenue TTM" value={`₹${crore(ttm.revenue)} Cr`} />}
          {ttm.pat != null && <Stat label="PAT TTM" value={`₹${crore(ttm.pat)} Cr`} />}
          {!ov.is_lender && ov.annual.opm.length > 0 && <Stat label="OPM FY" value={`${ov.annual.opm[ov.annual.opm.length - 1] ?? "–"}%`} />}
          {keys
            .filter((k) => ov.ratios[k])
            .map((k) => (
              <Stat key={k} label={k.replace("Stock ", "")} value={ov.ratios[k].replace("Cr.", "Cr")} />
            ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel px-2.5 py-2">
      <div className="text-[10px] text-faint">{label}</div>
      <div className="num mt-0.5 truncate text-[12.5px]">{value}</div>
    </div>
  );
}

export function NumbersSection({ ov }: { ov: Overview }) {
  const a = ov.annual;
  const q = ov.quarterly;
  const b = ov.balance_sheet;
  const c = ov.cash;
  const signals = (area: string) => ov.signals.filter((s) => s.area === area);
  return (
    <div className="space-y-6">
      <div>
        <H right={<span className="text-[10px] text-faint">bars: revenue ₹Cr · line: {ov.is_lender ? "PAT" : "OPM %"}</span>}>Trajectory · annual</H>
        <Bars annual labels={a.periods} values={a.revenue} format={(v) => crore(v)} line={ov.is_lender ? a.pat : a.opm} height={90} />
        <SignalList items={signals("trajectory")} />
      </div>
      <div>
        <H right={<span className="text-[10px] text-faint">YoY revenue growth %</span>}>Last {q.periods.length} quarters</H>
        <Bars labels={q.periods} values={q.yoy_growth} format={(v) => `${v.toFixed(0)}`} height={70} />
      </div>
      {!ov.is_lender && (
        <div>
          <H>Balance sheet</H>
          <div className="grid grid-cols-[1fr_repeat(3,auto)] gap-x-4 gap-y-1 text-[12px]">
            <span className="text-faint" />
            {b.periods.slice(-3).map((p) => (
              <span key={p} className="num text-right text-[10px] text-faint">
                {p}
              </span>
            ))}
            <TRow label="Borrowings ₹Cr" vals={b.borrowings.slice(-3)} f={crore} />
            <TRow label="Net worth ₹Cr" vals={b.net_worth.slice(-3)} f={crore} />
            <TRow label="Debt / Equity" vals={b.debt_to_equity.slice(-3)} f={(v) => v.toFixed(2)} />
            <TRow label="Cash conv. cycle (d)" vals={b.cash_conversion_cycle.slice(-3)} f={(v) => v.toFixed(0)} />
            <TRow label="Debtor days" vals={b.debtor_days.slice(-3)} f={(v) => v.toFixed(0)} />
            <TRow label="ROCE %" vals={b.roce.slice(-3)} f={(v) => v.toFixed(0)} />
          </div>
          <SignalList items={signals("balance_sheet").concat(signals("returns"))} />
        </div>
      )}
      {!ov.is_lender && (
        <div>
          <H right={c.cumulative_conversion_pct != null && <span className="num text-[11px] text-muted">{c.cumulative_conversion_pct}% cumulative</span>}>
            Cash quality · CFO ÷ PAT
          </H>
          <Bars annual labels={c.periods} values={c.cfo_to_pat_pct} format={(v) => `${v.toFixed(0)}`} height={70} highlightLast={false} />
          <div className="mt-2 grid grid-cols-[1fr_repeat(3,auto)] gap-x-4 gap-y-1 text-[12px]">
            <span />
            {c.periods.slice(-3).map((p) => (
              <span key={p} className="num text-right text-[10px] text-faint">
                {p}
              </span>
            ))}
            <TRow label="Operating cash" vals={c.cfo.slice(-3)} f={crore} />
            <TRow label="Free cash flow" vals={c.fcf.slice(-3)} f={crore} />
            <TRow label="PAT" vals={c.pat.slice(-3)} f={crore} />
          </div>
          <SignalList items={signals("cash")} />
        </div>
      )}
      <a href={ov.source} target="_blank" rel="noreferrer" className="block text-[10px] text-faint underline decoration-dotted">
        Standardised statements ({ov.basis}) from screener.in, built from company filings ↗
      </a>
    </div>
  );
}

function TRow({ label, vals, f }: { label: string; vals: (number | null)[]; f: (v: number) => string }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      {vals.map((v, i) => (
        <span key={i} className={`num text-right ${i === vals.length - 1 ? "text-ink" : "text-muted"}`}>
          {v == null ? "–" : f(v)}
        </span>
      ))}
    </>
  );
}

export function SignalList({ items }: { items: Overview["signals"] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((s) => (
        <li key={s.text} className="flex gap-2 text-[12px] leading-snug">
          <span className={s.tone === "good" ? "text-up" : s.tone === "bad" ? "text-down" : "text-faint"}>●</span>
          <span className="text-ink/90">{s.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function BullBearSection({ symbol }: { symbol: string }) {
  const { data, error, retry } = useSection<BullBear>(symbol, "bullbear", true);
  if (error) return <ErrorNote message={error} onRetry={retry} />;
  if (!data) return <Loading label="Building both cases from the numbers and the calls…" />;
  return (
    <div className="space-y-4">
      {(["bull", "bear"] as const).map((side) => (
        <div key={side}>
          <H>{side === "bull" ? "Bull case" : "Bear case"}</H>
          <div className="space-y-2">
            {data[side].map((p, i) => (
              <div key={i} className={`rounded-xl border-l-2 bg-panel p-3 ${side === "bull" ? "border-up" : "border-down"}`}>
                <div className="text-[13px] leading-snug">{p.point}</div>
                <div className="mt-1 text-[11px] text-faint">{p.evidence}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {data.watch_next?.length > 0 && (
        <div>
          <H>Next quarter will tell you</H>
          <ul className="space-y-1">
            {data.watch_next.map((w) => (
              <li key={w} className="text-[12.5px] text-ink/90">
                → {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function GovernanceSection({ symbol }: { symbol: string }) {
  const { data, error, retry } = useSection<Governance>(symbol, "governance", true);
  if (error) return <ErrorNote message={error} onRetry={retry} />;
  if (!data) return <Loading label="Scanning the annual report for auditor remarks, contingent liabilities and related-party deals… (large PDF, first run ~1 min)" />;
  const sev: Record<string, string> = { high: "text-down", medium: "text-warn", low: "text-muted" };
  return (
    <div className="space-y-4">
      {data.flags?.length > 0 && (
        <ul className="space-y-1.5">
          {data.flags.map((f) => (
            <li key={f.text} className="flex gap-2 text-[12.5px] leading-snug">
              <span className={`${sev[f.severity]} text-[10px] font-semibold uppercase`}>{f.severity}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-line bg-panel p-3 text-[12px]">
        <div className="flex justify-between">
          <span className="text-muted">Auditor opinion</span>
          <span className={data.auditor.opinion === "unmodified" ? "text-up" : "text-warn"}>{data.auditor.opinion}</span>
        </div>
        {data.auditor.key_audit_matters?.length > 0 && (
          <div className="mt-2 text-[11.5px] text-muted">Key audit matters: {data.auditor.key_audit_matters.join(" · ")}</div>
        )}
        {data.auditor.emphasis_or_uncertainty && <div className="mt-1 text-[11.5px] text-warn">{data.auditor.emphasis_or_uncertainty}</div>}
      </div>
      <div className="rounded-xl border border-line bg-panel p-3 text-[12px]">
        <div className="flex justify-between">
          <span className="text-muted">Contingent liabilities</span>
          <span className="num">{data.contingent_liabilities.total ?? "–"}</span>
        </div>
        <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-muted">
          {data.contingent_liabilities.largest_items?.map((x) => (
            <li key={x}>· {x}</li>
          ))}
        </ul>
      </div>
      {data.related_party?.length > 0 && (
        <div className="rounded-xl border border-line bg-panel p-3 text-[12px]">
          <div className="text-muted">Related-party transactions</div>
          <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-ink/85">
            {data.related_party.map((x) => (
              <li key={x}>· {x}</li>
            ))}
          </ul>
        </div>
      )}
      <a href={data.source.url} target="_blank" rel="noreferrer" className="block text-[10px] text-faint underline decoration-dotted">
        {data.source.title}: read pages {data.source.pages.join(", ")} of {data.source.total_pages} ↗
      </a>
    </div>
  );
}