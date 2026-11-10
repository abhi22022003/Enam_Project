"use client";

import { useEffect, useMemo, useState } from "react";
import { api, Digest, MarketAlert, Story } from "@/lib/api";
import { ago, greeting, pct, shortDate, tone } from "@/lib/format";
import { Settings } from "@/lib/settings";
import { CategoryTag, StoryCard } from "./cards";
import { ErrorNote, Skeleton } from "./ui";

const WINDOWS = [
  { id: "24h", label: "24h" },
  { id: "3d", label: "3D" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
];

function WindowPicker({
  value,
  custom,
  onChange,
  onCustom,
}: {
  value: string;
  custom: { start: string; end: string } | null;
  onChange: (w: string) => void;
  onCustom: (c: { start: string; end: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(() => custom?.start ?? new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10));
  const [end, setEnd] = useState(custom?.end ?? today);
  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-panel p-1">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            onClick={() => {
              onCustom(null);
              setOpen(false);
              onChange(w.id);
            }}
            className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition ${!custom && value === w.id ? "bg-panel-2 text-ink shadow" : "text-muted"}`}
          >
            {w.label}
          </button>
        ))}
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex-1 rounded-md py-1.5 text-[12px] font-medium ${custom ? "bg-panel-2 text-ink" : "text-muted"}`}
        >
          {custom ? `${shortDate(custom.start)}–${shortDate(custom.end)}` : "Custom"}
        </button>
      </div>
      {open && (
        <div className="fade-in mt-2 flex items-end gap-2 rounded-lg border border-line bg-panel p-2 text-[12px]">
          <label className="flex flex-1 flex-col gap-1 text-faint">
            From
            <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="rounded bg-panel-2 px-2 py-1 text-ink [color-scheme:dark]" />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-faint">
            To
            <input type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} className="rounded bg-panel-2 px-2 py-1 text-ink [color-scheme:dark]" />
          </label>
          <button
            onClick={() => {
              onCustom({ start, end });
              setOpen(false);
            }}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function MoveCard({ a, onStory, onResearch }: { a: MarketAlert; onStory: (id: string) => void; onResearch: (s: string) => void }) {
  return (
    <div className="w-[200px] shrink-0 rounded-xl border border-line bg-panel p-3">
      <div className="flex items-baseline justify-between">
        <button onClick={() => onResearch(a.symbol)} className="num text-[12px] font-semibold">
          {a.symbol}
        </button>
        <span className={`num text-[13px] font-semibold ${tone(a.change_pct)}`}>{pct(a.change_pct)}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-faint">{shortDate(a.date)} close</div>
      <ul className="mt-2 space-y-0.5">
        {a.triggers.map((t) => (
          <li key={t.kind} className="text-[11.5px] text-ink/90">
            {t.text}
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-line pt-2 text-[11px]">
        {a.unexplained ? (
          <span className="text-warn">No filing explains this move</span>
        ) : (
          <button onClick={() => onStory(a.context[0].story_id)} className="line-clamp-2 text-left text-accent">
            Likely: {a.context[0].headline}
          </button>
        )}
      </div>
    </div>
  );
}

export default function BriefView({ settings, onSettings, onResearch }: { settings: Settings; onSettings: (p: Partial<Settings>) => void; onResearch: (s: string) => void }) {
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [showRoutine, setShowRoutine] = useState(false);
  const [nonce, setNonce] = useState(0);
  const params = useMemo(
    () => ({ window: settings.window, start: custom?.start, end: custom?.end, interests: settings.interests, volX: settings.volX, movePct: settings.movePct }),
    [settings.window, settings.interests, settings.volX, settings.movePct, custom],
  );
  const key = `${JSON.stringify(params)}|${nonce}`;
  const [res, setRes] = useState<{ key: string; data?: Digest; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .digest(params)
      .then((d) => alive && setRes({ key, data: d }))
      .catch((e) => alive && setRes({ key, error: e.message || "Could not load the digest" }));
    return () => {
      alive = false;
    };
  }, [key, params]);

  const loading = res?.key !== key;
  const data = res?.data ?? null;
  const error = !loading ? (res?.error ?? null) : null;
  const load = () => setNonce((n) => n + 1);

  const alertedStories = useMemo(() => new Set(data?.alerts.filter((a) => a.kind === "filing").map((a) => (a as { story_id: string }).story_id)), [data]);
  const moves = (data?.alerts.filter((a) => a.kind === "market") ?? []) as MarketAlert[];

  const scrollToStory = (id: string) => document.getElementById(`story-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const critical = data?.stories.filter((s) => s.tier === "critical") ?? [];
  const notable = data?.stories.filter((s) => s.tier === "notable") ?? [];
  const windowLabel = custom ? "in this period" : settings.window === "24h" ? "since yesterday" : `in the last ${settings.window.replace("d", " days")}`;

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <p className="text-[12px] text-faint">{greeting()}</p>
          {data && !loading ? (
            <h1 className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight">
              {data.counts.critical + data.counts.notable === 0 ? (
                <>Nothing needs you {windowLabel}.</>
              ) : (
                <>
                  <span className="text-ink">{data.counts.critical + data.counts.notable} things</span>{" "}
                  <span className="text-muted">matter {windowLabel}.</span>
                </>
              )}
            </h1>
          ) : (
            <Skeleton className="mt-1 h-7 w-3/4" />
          )}
          {data && !loading && (
            <p className="mt-1 text-[12px] text-faint">
              FINN read <span className="num text-muted">{data.counts.filings}</span> filings across 18 holdings
              {data.counts.routine_filings > 0 && (
                <>
                  {" "}and set aside <span className="num text-muted">{data.counts.routine_filings}</span> as routine
                </>
              )}
              .
            </p>
          )}
        </div>
        <WindowPicker value={settings.window} custom={custom} onChange={(w) => onSettings({ window: w })} onCustom={setCustom} />
      </header>

      {error && <ErrorNote message={error} onRetry={load} />}

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {data && !loading && (
        <>
          {moves.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-faint">Unusual moves</h2>
                <span className="text-[10px] text-faint">
                  vol ≥ {settings.volX}× · move ≥ ±{settings.movePct}%
                </span>
              </div>
              <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {moves.map((a) => (
                  <MoveCard key={a.id} a={a} onStory={scrollToStory} onResearch={onResearch} />
                ))}
              </div>
            </section>
          )}

          {critical.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-crit">Needs your attention</h2>
              {critical.map((s) => (
                <div id={`story-${s.id}`} key={s.id}>
                  <StoryCard story={s} alerted={alertedStories.has(s.id)} onResearch={onResearch} />
                </div>
              ))}
            </section>
          )}

          {notable.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-faint">Worth knowing</h2>
              {notable.map((s) => (
                <div id={`story-${s.id}`} key={s.id}>
                  <StoryCard story={s} alerted={false} onResearch={onResearch} />
                </div>
              ))}
            </section>
          )}

          {data.routine.length > 0 && (
            <section className="rounded-xl border border-line/60 bg-panel/50">
              <button onClick={() => setShowRoutine((v) => !v)} className="flex w-full items-center justify-between px-3.5 py-3 text-left">
                <div>
                  <div className="text-[13px] font-medium text-muted">{data.counts.routine_filings} routine filings, collapsed</div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {data.routine_by_category
                      .slice(0, 4)
                      .map(([c, n]) => `${c} ${n}`)
                      .join(" · ")}
                  </div>
                </div>
                <span className="text-faint">{showRoutine ? "−" : "+"}</span>
              </button>
              {showRoutine && <RoutineList stories={data.routine} />}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function RoutineList({ stories }: { stories: Story[] }) {
  return (
    <ul className="divide-y divide-line/60 border-t border-line/60">
      {stories.flatMap((s) =>
        s.filings.map((f) => (
          <li key={f.id} className="flex items-start gap-2 px-3.5 py-2">
            <span className="num w-[76px] shrink-0 text-[11px] font-medium text-muted">{s.symbol}</span>
            <div className="min-w-0 flex-1">
              <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="line-clamp-2 text-[11.5px] text-muted hover:text-ink">
                {f.subject}
              </a>
              <div className="mt-0.5 flex items-center gap-2">
                <CategoryTag category={s.category} label={s.category_label} />
                <span className="text-[10px] text-faint">{ago(f.time)}</span>
                {f.classified_by === "unreviewed" && <span className="text-[10px] text-faint">· not reviewed</span>}
              </div>
            </div>
          </li>
        )),
      )}
    </ul>
  );
}
