"use client";

import { useEffect, useState } from "react";
import { api, Enrichment, MgmtCard, ResultsCard, Story } from "@/lib/api";
import { enrichCache } from "@/lib/enrichCache";
import { ago, crore, pct, tone } from "@/lib/format";
import { Skeleton, Tag } from "./ui";

type CatStyle = { text: string; bar: string; soft: string };

const CAT: Record<string, CatStyle> = {
  results: { text: "text-accent", bar: "bg-accent", soft: "bg-accent/15" },
  management_change: { text: "text-warn", bar: "bg-warn", soft: "bg-warn/15" },
  "M&A": { text: "text-fuchsia-300", bar: "bg-fuchsia-400", soft: "bg-fuchsia-400/15" },
  litigation: { text: "text-down", bar: "bg-down", soft: "bg-down/15" },
  fund_raise: { text: "text-teal-300", bar: "bg-teal-400", soft: "bg-teal-400/15" },
  credit_rating: { text: "text-sky-300", bar: "bg-sky-400", soft: "bg-sky-400/15" },
  pledging: { text: "text-down", bar: "bg-down", soft: "bg-down/15" },
};
const PLAIN: CatStyle = { text: "text-muted", bar: "bg-faint", soft: "bg-white/5" };
const catStyle = (c: string) => CAT[c] ?? PLAIN;

export function CategoryTag({ category, label }: { category: string; label: string }) {
  const s = catStyle(category);
  return <Tag className={`${s.soft} ${s.text}`}>{label}</Tag>;
}

function Move({ r, compact = false }: { r: Story["price_reaction"]; compact?: boolean }) {
  if (!r || r.change_pct == null) return null;
  const vol = r.vol_ratio != null && r.vol_ratio >= 1.5;
  return (
    <div className="shrink-0 text-right" title={`Price reaction on ${r.date}`}>
      <div className={`num font-semibold leading-none ${compact ? "text-[12.5px]" : "text-[17px]"} ${tone(r.change_pct)}`}>{pct(r.change_pct)}</div>
      {vol && !compact && <div className="num mt-1 text-[10px] text-faint">{r.vol_ratio!.toFixed(1)}× volume</div>}
    </div>
  );
}

function spokenPct(v: number) {
  return `${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}%`;
}

function resultsHeadline(story: Story, card: ResultsCard): string | null {
  const yoy = (m: string) => card.table.find((r) => r.metric === m)?.yoy_pct ?? null;
  const pat = yoy("PAT");
  const rev = yoy("Revenue");
  if (pat == null && rev == null) return null;
  const period = story.headline.replace(/\s*(results)?\s*filed$/i, "") || "Results";
  const parts = [
    pat != null && `profit ${pat >= 0 ? "up" : "down"} ${spokenPct(pat)}`,
    rev != null && `revenue ${rev >= 0 ? "up" : "down"} ${spokenPct(rev)}`,
  ].filter(Boolean);
  return `${period}: ${parts.join(", ")} YoY`;
}

function ResultsView({ card }: { card: ResultsCard }) {
  if (card.error) return <p className="mt-2 text-[12px] text-muted">{card.error}</p>;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-2">
        {card.table.map((r) => (
          <MetricTile key={r.metric} r={r} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-faint">
        <span>
          ₹ Cr · {card.basis} · {card.periods.current?.label}
        </span>
        <span>·</span>
        {card.source === "filing" ? (
          <a href={card.source_url ?? "#"} target="_blank" rel="noreferrer" className="underline decoration-dotted">
            from filing p.{card.source_pages?.join(", ")}
          </a>
        ) : (
          <span title={card.note}>from screener.in{card.note && " ⓘ"}</span>
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

function MetricTile({ r }: { r: ResultsCard["table"][number] }) {
  const mDelta = r.margin != null && r.margin_year_ago != null ? r.margin - r.margin_year_ago : null;
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[11px] font-medium text-muted">{r.metric}</span>
        {r.margin != null && (
          <span className="num text-[10px] text-faint">
            {r.margin.toFixed(1)}%{mDelta != null && <span className={tone(mDelta)}> {mDelta > 0 ? "▲" : "▼"}</span>}
          </span>
        )}
      </div>
      <div className="num mt-0.5 text-[17px] font-semibold tracking-tight text-ink">{crore(r.current)}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5 text-[11px]">
        <span className={`num font-semibold ${tone(r.yoy_pct)}`}>{pct(r.yoy_pct, 0)}</span>
        <span className="text-faint">YoY</span>
        <span className={`num ml-1 ${tone(r.qoq_pct)}`}>{pct(r.qoq_pct, 0)}</span>
        <span className="text-faint">QoQ</span>
      </div>
    </div>
  );
}

const plainName = (name: string) => name.replace(/^(mr|ms|mrs|dr|shri|smt)\.?\s+/i, "").trim();

const initials = (name: string) =>
  plainName(name)
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function MgmtView({ card }: { card: MgmtCard }) {
  if (!card.changes.length) return card.llm === false ? <p className="mt-2 text-[12px] text-faint">Add an LLM key to read who changed and their background.</p> : null;
  const people = [...new Map(card.changes.map((c) => [plainName(c.person).toLowerCase(), c])).values()];
  return (
    <div className="mt-3 space-y-2">
      {people.slice(0, 3).map((c, i) => {
        const exit = /resign|retire|ceas|demise/i.test(c.change);
        return (
          <div key={i} className="rounded-xl bg-panel-2 p-3">
            <div className="flex items-center gap-3">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${exit ? "bg-down/15 text-down" : "bg-up/15 text-up"}`}>
                {initials(c.person)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold leading-snug">{plainName(c.person)}</div>
                <div className="line-clamp-2 text-[11.5px] leading-snug text-muted">{c.role}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize ${exit ? "bg-down/15 text-down" : "bg-up/15 text-up"}`}>
                {c.change}
              </span>
            </div>
            {c.background && <p className="mt-2 line-clamp-4 text-[12.5px] leading-relaxed text-ink/85">{c.background}</p>}
            {c.reason && exit && <p className="mt-1.5 text-[11.5px] text-muted">Reason: {c.reason}</p>}
            <div className="mt-2 flex items-center gap-3 text-[11px] text-faint">
              {c.effective_date && <span>From {c.effective_date}</span>}
              <a href={c.linkedin_search} target="_blank" rel="noreferrer" className="ml-auto text-accent">
                LinkedIn →
              </a>
            </div>
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

function withoutCompany(headline: string, names: string[]) {
  for (const n of names) {
    const m = headline.match(new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s+(limited|ltd\\.?))?('s)?\\s+`, "i"));
    if (m) {
      const rest = headline.slice(m[0].length);
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  }
  return headline;
}

function storyText(story: Story, data: Enrichment | null, name: string) {
  const headline =
    data?.type === "management_change" && data.headline
      ? withoutCompany(data.headline, [name, story.company, story.symbol])
      : data?.type === "results" && !data.error
        ? (resultsHeadline(story, data) ?? story.headline)
        : story.headline;
  const gist = (data?.type === "summary" ? data.summary : null) ?? story.gist ?? story.summary;
  return { headline, gist: data?.type === "results" || data?.type === "management_change" ? null : gist };
}

function Actions({ story, onResearch, onDone, onSummarise }: { story: Story; onResearch: (s: string) => void; onDone?: () => void; onSummarise?: () => void }) {
  const primary = story.filings[0];
  return (
    <div className="flex items-center gap-4 text-[12px]">
      {onSummarise && (
        <button onClick={onSummarise} className="font-medium text-accent">
          Summarise
        </button>
      )}
      {primary?.url && (
        <a href={primary.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
          Filing ↗
        </a>
      )}
      <button onClick={() => onResearch(story.symbol)} className="text-muted hover:text-ink">
        Research
      </button>
      {onDone && (
        <button onClick={onDone} aria-label="Mark as done" className="ml-auto rounded-full bg-white/5 px-3 py-1 font-medium text-muted hover:bg-white/10 hover:text-ink">
          ✓ Done
        </button>
      )}
    </div>
  );
}

export function StoryCard({
  story,
  name,
  alerted,
  onResearch,
  onDone,
  highlight = false,
}: {
  story: Story;
  name: string;
  alerted: boolean;
  onResearch: (s: string) => void;
  onDone?: () => void;
  highlight?: boolean;
}) {
  const needsCard = story.category === "results" || story.category === "management_change" || !(story.gist || story.summary);
  const { data, loading } = useEnrichment(story, needsCard);
  const [more, setMore] = useState(false);
  const cat = catStyle(story.category);
  const { headline, gist } = storyText(story, data, name);

  return (
    <article
      className={`fade-in relative overflow-hidden rounded-2xl bg-panel ring-1 transition-shadow duration-300 ${
        highlight ? "shadow-[0_0_0_2px_var(--color-accent)] ring-transparent" : "ring-line"
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${cat.bar}`} />
      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider">
              <span className={cat.text}>{story.category_label}</span>
              {alerted && <span className="rounded-full bg-crit/15 px-1.5 py-px text-[9.5px] text-crit">Alert</span>}
              <span className="font-normal normal-case tracking-normal text-faint">{ago(story.time)}</span>
            </div>
            <button onClick={() => onResearch(story.symbol)} className="mt-1 flex items-baseline gap-1.5 text-left">
              <span className="text-[14px] font-semibold text-ink">{name}</span>
              <span className="num text-[10.5px] text-faint">{story.symbol}</span>
            </button>
          </div>
          <Move r={story.price_reaction} />
        </div>

        <h3 className="mt-2 line-clamp-3 text-[17px] font-semibold leading-snug tracking-tight text-ink">{headline}</h3>

        {gist && (
          <p onClick={() => setMore((v) => !v)} className={`mt-1.5 text-[13.5px] leading-relaxed text-muted ${more ? "" : "line-clamp-2"}`}>
            {gist}
          </p>
        )}
        {data?.type === "summary" && data.key_figure && <p className="num mt-1.5 text-[12.5px] font-medium text-accent">{data.key_figure}</p>}

        {loading && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        )}
        {data?.type === "results" && <ResultsView card={data} />}
        {data?.type === "management_change" && <MgmtView card={data} />}

        <div className="mt-3 border-t border-line/60 pt-2.5">
          <Actions story={story} onResearch={onResearch} onDone={onDone} />
        </div>
      </div>
    </article>
  );
}

export function CompactStory({
  story,
  name,
  onResearch,
  onDone,
}: {
  story: Story;
  name: string;
  onResearch: (s: string) => void;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, loading, request, requested } = useEnrichment(story, false);
  const cat = catStyle(story.category);
  const { headline, gist } = storyText(story, data, name);

  return (
    <div className="px-4 py-3">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 text-left" aria-expanded={open}>
        <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${cat.bar}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="font-semibold text-ink/90">{name}</span>
            <span className="truncate text-faint">
              · {story.category_label} · {ago(story.time)}
            </span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[14.5px] font-medium leading-snug text-ink">{headline}</div>
        </div>
        <Move r={story.price_reaction} compact />
      </button>
      {open && (
        <div className="fade-in mt-2 space-y-2.5 pl-5">
          {gist && <p className="text-[13px] leading-relaxed text-muted">{gist}</p>}
          {loading && <Skeleton className="h-10 w-full" />}
          {data?.type === "results" && <ResultsView card={data} />}
          {data?.type === "management_change" && <MgmtView card={data} />}
          <Actions story={story} onResearch={onResearch} onDone={onDone} onSummarise={!requested && !gist ? request : undefined} />
        </div>
      )}
    </div>
  );
}
