"use client";

import { useEffect, useState } from "react";
import { api, Enrichment, MgmtCard, ResultsCard, Story } from "@/lib/api";
import { enrichCache } from "@/lib/enrichCache";
import { ago, crore, pct, tone } from "@/lib/format";
import { Skeleton, Tag } from "./ui";

const CAT_STYLE: Record<string, string> = {
  results: "bg-accent/15 text-accent",
  management_change: "bg-warn/15 text-warn",
  "M&A": "bg-fuchsia-400/15 text-fuchsia-300",
  litigation: "bg-down/15 text-down",
  fund_raise: "bg-teal-400/15 text-teal-300",
  credit_rating: "bg-sky-400/15 text-sky-300",
  pledging: "bg-down/15 text-down",
};

export function CategoryTag({ category, label }: { category: string; label: string }) {
  return <Tag className={CAT_STYLE[category] ?? "bg-white/5 text-muted"}>{label}</Tag>;
}

function Reaction({ r }: { r: Story["price_reaction"] }) {
  if (!r || r.change_pct == null) return null;
  const loud = Math.abs(r.change_pct) >= 2 || (r.vol_ratio ?? 0) >= 2;
  return (
    <span className={`num shrink-0 rounded px-1.5 py-0.5 text-[10px] ${loud ? "bg-white/5" : ""} ${tone(r.change_pct)}`} title={`Market reaction on ${r.date}`}>
      {pct(r.change_pct)}
      {r.vol_ratio != null && r.vol_ratio >= 1.5 && <span className="text-muted"> · {r.vol_ratio.toFixed(1)}× vol</span>}
    </span>
  );
}

function ResultsView({ card }: { card: ResultsCard }) {
  if (card.error) return <p className="text-xs text-muted">{card.error}</p>;
  const cur = card.periods.current?.label;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-[12px]">
        <span className="text-[10px] uppercase tracking-wide text-faint">{card.unit} · {card.basis}</span>
        <span className="num text-right text-[10px] text-faint">{cur}</span>
        <span className="text-right text-[10px] text-faint">QoQ</span>
        <span className="text-right text-[10px] text-faint">YoY</span>
        {card.table.map((r) => (
          <Row key={r.metric} r={r} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-faint">
        {card.source === "filing" ? (
          <a href={card.source_url ?? "#"} target="_blank" rel="noreferrer" className="underline decoration-dotted">
            Read from filing p.{card.source_pages?.join(", ")}
          </a>
        ) : (
          <span>From screener.in quarterly table</span>
        )}
        {card.cross_check && (
          <span className={card.cross_check.agrees ? "text-up" : "text-warn"}>
            {card.cross_check.agrees ? "✓ matches" : "≠ differs from"} {card.cross_check.against}
          </span>
        )}
        {!card.is_lender && <span title={card.ebitda_note}>EBITDA ⓘ</span>}
      </div>
    </div>
  );
}

function Row({ r }: { r: ResultsCard["table"][number] }) {
  const mDelta = r.margin != null && r.margin_year_ago != null ? r.margin - r.margin_year_ago : null;
  return (
    <>
      <span className="text-muted">
        {r.metric}
        {r.margin != null && (
          <span className="num ml-1.5 text-[10px] text-faint">
            {r.margin.toFixed(1)}%{mDelta != null && <span className={tone(mDelta)}> {mDelta > 0 ? "▲" : "▼"}{Math.abs(mDelta).toFixed(1)}</span>}
          </span>
        )}
      </span>
      <span className="num text-right">{crore(r.current)}</span>
      <span className={`num text-right ${tone(r.qoq_pct)}`}>{pct(r.qoq_pct, 0)}</span>
      <span className={`num text-right font-medium ${tone(r.yoy_pct)}`}>{pct(r.yoy_pct, 0)}</span>
    </>
  );
}

function MgmtView({ card }: { card: MgmtCard }) {
  if (!card.changes.length) return card.llm === false ? <p className="mt-2 text-xs text-faint">Add an LLM key to read who changed and their background.</p> : null;
  return (
    <div className="mt-3 space-y-3">
      {card.changes.slice(0, 4).map((c, i) => {
        const exit = /resign|retire|ceas|demise/i.test(c.change);
        return (
          <div key={i} className="rounded-lg border border-line bg-panel-2 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[13px] font-semibold">{c.person}</div>
              <Tag className={exit ? "bg-down/15 text-down" : "bg-up/15 text-up"}>{c.change}</Tag>
            </div>
            <div className="text-[11px] text-muted">
              {c.role}
              {c.effective_date && <span className="text-faint"> · from {c.effective_date}</span>}
            </div>
            {c.background && <p className="mt-1.5 text-[12px] leading-snug text-ink/90">{c.background}</p>}
            {c.reason && exit && <p className="mt-1 text-[11px] text-muted">Reason given: {c.reason}</p>}
            {c.previous_roles?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.previous_roles.slice(0, 3).map((p) => (
                  <span key={p} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">
                    {p}
                  </span>
                ))}
              </div>
            )}
            <a href={c.linkedin_search} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-accent">
              LinkedIn →
            </a>
          </div>
        );
      })}
    </div>
  );
}

export function useEnrichment(story: Story, auto: boolean) {
  const [data, setData] = useState<Enrichment | null>(() => enrichCache.get(story.id) ?? null);
  const [requested, setRequested] = useState(auto);
  useEffect(() => {
    if (!requested || enrichCache.has(story.id)) return;
    let alive = true;
    api
      .enrich(story)
      .then((d) => {
        enrichCache.set(story.id, d);
        if (alive) setData(d);
      })
      .catch(() => alive && setData({ type: "summary", summary: null }));
    return () => {
      alive = false;
    };
  }, [requested, story]);
  return { data, loading: requested && !data, request: () => setRequested(true), requested };
}

export function StoryCard({
  story,
  alerted,
  onResearch,
  onDone,
  highlight = false,
}: {
  story: Story;
  alerted: boolean;
  onResearch: (s: string) => void;
  onDone?: () => void;
  highlight?: boolean;
}) {
  const critical = story.tier === "critical";
  const { data, loading, request, requested } = useEnrichment(story, critical);
  const [showFilings, setShowFilings] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const primary = story.filings[0];
  const summary = data?.type === "summary" ? data.summary : null;
  const headline = data?.type === "management_change" && data.headline ? data.headline : story.headline;
  const oneLiner = summary ?? story.summary;

  return (
    <article
      className={`fade-in rounded-xl border bg-panel p-3.5 transition-shadow duration-300 ${critical ? "border-line" : "border-line/60"} ${
        highlight ? "shadow-[0_0_0_2px_var(--color-accent)]" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button onClick={() => onResearch(story.symbol)} className="num text-[12px] font-semibold tracking-tight text-ink">
          {story.symbol}
        </button>
        <CategoryTag category={story.category} label={story.category_label} />
        {alerted && <Tag className="bg-crit/15 text-crit">Alert</Tag>}
        <span className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-[10px] text-faint">{ago(story.time)}</span>
          <Reaction r={story.price_reaction} />
        </span>
      </div>
      <h3 className={`mt-1.5 line-clamp-3 leading-snug ${critical ? "text-[15px] font-semibold" : "text-[13.5px] font-medium text-ink/90"}`}>{headline}</h3>

      {oneLiner && (
        <p onClick={() => setExpanded((v) => !v)} className={`mt-1 text-[12.5px] leading-snug text-muted ${expanded ? "" : "line-clamp-3"}`}>
          {oneLiner}
        </p>
      )}
      {data?.type === "summary" && data.key_figure && <p className="num mt-1 text-[12px] text-accent">{data.key_figure}</p>}

      {loading && (
        <div className="mt-3 space-y-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      )}
      {data?.type === "results" && <ResultsView card={data} />}
      {data?.type === "management_change" && <MgmtView card={data} />}

      <div className="mt-2.5 flex items-center gap-3 text-[11px]">
        {!requested && !oneLiner && (
          <button onClick={request} className="text-accent">
            Summarise
          </button>
        )}
        {primary?.url && (
          <a href={primary.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
            Filing ↗
          </a>
        )}
        {story.filings.length > 1 && (
          <button onClick={() => setShowFilings((v) => !v)} className="text-muted">
            {showFilings ? "Hide" : `+${story.filings.length - 1} related`}
          </button>
        )}
        <button onClick={() => onResearch(story.symbol)} className="ml-auto text-muted hover:text-ink">
          Research →
        </button>
        {onDone && (
          <button onClick={onDone} className="rounded-md border border-line px-2 py-0.5 text-muted hover:text-ink" aria-label="Mark as done">
            ✓ Done
          </button>
        )}
      </div>
      {showFilings && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {story.filings.map((f) => (
            <li key={f.id} className="flex gap-2 text-[11px]">
              <span className="w-12 shrink-0 text-faint">{ago(f.time)}</span>
              <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="line-clamp-2 text-muted hover:text-ink">
                {f.subject}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
