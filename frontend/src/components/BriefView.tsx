"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, Digest, MarketAlert, Story } from "@/lib/api";
import { buildBrief, estimateSeconds, Line, pickVoice } from "@/lib/brief";
import { ago, greeting, pct, shortDate, tone } from "@/lib/format";
import { doneStories, lastSeen } from "@/lib/local";
import { Settings } from "@/lib/settings";
import { CategoryTag, StoryCard } from "./cards";
import { ErrorNote, Skeleton } from "./ui";

const WINDOWS = [
  { id: "24h", label: "24h" },
  { id: "3d", label: "3D" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
];

type Mode = { kind: "since"; since: string } | { kind: "window" } | { kind: "custom"; start: string; end: string };

function WindowPicker({
  mode,
  value,
  since,
  onWindow,
  onSince,
  onCustom,
}: {
  mode: Mode;
  value: string;
  since: string | null;
  onWindow: (w: string) => void;
  onSince: () => void;
  onCustom: (start: string, end: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(() => new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10));
  const [end, setEnd] = useState(today);
  const chip = (active: boolean) => `flex-1 rounded-md py-1.5 text-[12px] font-medium transition ${active ? "bg-panel-2 text-ink shadow" : "text-muted"}`;
  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-panel p-1">
        {since && (
          <button onClick={onSince} className={chip(mode.kind === "since")} title={`Since ${new Date(since).toLocaleString("en-IN")}`}>
            New
          </button>
        )}
        {WINDOWS.map((w) => (
          <button key={w.id} onClick={() => (setOpen(false), onWindow(w.id))} className={chip(mode.kind === "window" && value === w.id)}>
            {w.label}
          </button>
        ))}
        <button onClick={() => setOpen((o) => !o)} className={chip(mode.kind === "custom")}>
          {mode.kind === "custom" ? `${shortDate(mode.start)}–${shortDate(mode.end)}` : "Custom"}
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
          <button onClick={() => (onCustom(start, end), setOpen(false))} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg">
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

function useSpeech(lines: Line[], onLine: (l: Line | null) => void) {
  const [index, setIndex] = useState<number | null>(null);
  const cancelled = useRef(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const stop = () => {
    cancelled.current = true;
    window.speechSynthesis?.cancel();
    setIndex(null);
    onLine(null);
  };

  const play = () => {
    if (!supported || !lines.length) return;
    window.speechSynthesis.cancel();
    cancelled.current = false;
    const voice = pickVoice();
    const speak = (i: number) => {
      if (cancelled.current || i >= lines.length) {
        setIndex(null);
        onLine(null);
        return;
      }
      setIndex(i);
      onLine(lines[i]);
      const u = new SpeechSynthesisUtterance(lines[i].text);
      if (voice) u.voice = voice;
      u.rate = 1.04;
      u.onend = () => speak(i + 1);
      u.onerror = () => speak(i + 1);
      window.speechSynthesis.speak(u);
    };
    speak(0);
  };

  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return { supported, playing: index !== null, index, play, stop };
}

export default function BriefView({
  settings,
  onSettings,
  onResearch,
  names,
}: {
  settings: Settings;
  onSettings: (p: Partial<Settings>) => void;
  onResearch: (s: string) => void;
  names: Map<string, string>;
}) {
  const [visit] = useState(() => {
    const prev = lastSeen.get();
    const age = prev ? Date.now() - new Date(prev).getTime() : null;
    return { since: age != null && age > 3600e3 ? prev : null, recent: age != null && age > 3600e3 && age < 7 * 864e5 };
  });
  const sinceEligible = visit.since;
  const [mode, setMode] = useState<Mode>(() => (visit.recent && visit.since ? { kind: "since", since: visit.since } : { kind: "window" }));
  const [done, setDone] = useState<Set<string>>(() => doneStories.get());
  const [showRoutine, setShowRoutine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [reading, setReading] = useState<Line | null>(null);

  const params = useMemo(
    () => ({
      window: settings.window,
      since: mode.kind === "since" ? mode.since : undefined,
      start: mode.kind === "custom" ? mode.start : undefined,
      end: mode.kind === "custom" ? mode.end : undefined,
      interests: settings.interests,
      volX: settings.volX,
      movePct: settings.movePct,
    }),
    [settings.window, settings.interests, settings.volX, settings.movePct, mode],
  );
  const key = `${JSON.stringify(params)}|${nonce}`;
  const [res, setRes] = useState<{ key: string; data?: Digest; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .digest(params)
      .then((d) => {
        if (!alive) return;
        setRes({ key, data: d });
        lastSeen.touch();
      })
      .catch((e) => alive && setRes({ key, error: e.message || "Could not load the digest" }));
    return () => {
      alive = false;
    };
  }, [key, params]);

  const loading = res?.key !== key;
  const data = res?.data ?? null;
  const error = !loading ? (res?.error ?? null) : null;

  const windowLabel =
    mode.kind === "since"
      ? "since your last visit"
      : mode.kind === "custom"
        ? "in this period"
        : settings.window === "24h"
          ? "since yesterday"
          : `in the last ${settings.window.replace("d", " days")}`;

  const alertedStories = useMemo(() => new Set(data?.alerts.filter((a) => a.kind === "filing").map((a) => (a as { story_id: string }).story_id)), [data]);
  const moves = (data?.alerts.filter((a) => a.kind === "market") ?? []) as MarketAlert[];
  const open = data?.stories.filter((s) => !done.has(s.id)) ?? [];
  const cleared = data?.stories.filter((s) => done.has(s.id)) ?? [];
  const critical = open.filter((s) => s.tier === "critical");
  const notable = open.filter((s) => s.tier === "notable");

  const lines = useMemo(() => (data ? buildBrief(data, names, windowLabel, done) : []), [data, names, windowLabel, done]);
  const speech = useSpeech(lines, (l) => {
    setReading(l);
    if (l?.storyId) document.getElementById(`story-${l.storyId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const scrollToStory = (id: string) => document.getElementById(`story-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const markDone = (id: string) => {
    doneStories.add([id]);
    setDone(doneStories.get());
  };
  const restore = (id: string) => {
    doneStories.remove(id);
    setDone(doneStories.get());
  };

  const card = (s: Story, alerted: boolean) => (
    <div id={`story-${s.id}`} key={s.id}>
      <StoryCard story={s} alerted={alerted} onResearch={onResearch} onDone={() => markDone(s.id)} highlight={reading?.storyId === s.id} />
    </div>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-faint">{greeting()}</p>
            {data && !loading && speech.supported && lines.length > 1 && (
              <button
                onClick={speech.playing ? speech.stop : speech.play}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${speech.playing ? "bg-accent text-bg" : "bg-panel text-ink"}`}
              >
                {speech.playing ? (
                  <>
                    <span className="inline-block h-2 w-2 rounded-sm bg-bg" /> Stop
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-current">
                      <path d="M2 1l9 5-9 5z" />
                    </svg>
                    Listen · {estimateSeconds(lines)}s
                  </>
                )}
              </button>
            )}
          </div>
          {data && !loading ? (
            <h1 className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight">
              {critical.length + notable.length === 0 ? (
                cleared.length ? (
                  <>
                    You&apos;re clear. <span className="text-muted">Nothing left {windowLabel}.</span>
                  </>
                ) : (
                  <>Nothing needs you {windowLabel}.</>
                )
              ) : (
                <>
                  <span className="text-ink">
                    {critical.length + notable.length} thing{critical.length + notable.length > 1 ? "s" : ""}
                  </span>{" "}
                  <span className="text-muted">matter {windowLabel}.</span>
                </>
              )}
            </h1>
          ) : (
            <Skeleton className="mt-1 h-7 w-3/4" />
          )}
          {data && !loading && (
            <p className="mt-1 text-[12px] text-faint">
              FINN read <span className="num text-muted">{data.counts.filings}</span> filings across {names.size || 18} holdings
              {data.counts.routine_filings > 0 && (
                <>
                  {" "}
                  and set aside <span className="num text-muted">{data.counts.routine_filings}</span> as routine
                </>
              )}
              .
            </p>
          )}
        </div>
        <WindowPicker
          mode={mode}
          value={settings.window}
          since={sinceEligible}
          onSince={() => sinceEligible && setMode({ kind: "since", since: sinceEligible })}
          onWindow={(w) => {
            setMode({ kind: "window" });
            onSettings({ window: w });
          }}
          onCustom={(start, end) => setMode({ kind: "custom", start, end })}
        />
      </header>

      {speech.playing && reading && (
        <div className="fade-in sticky top-12 z-10 rounded-xl border border-accent/40 bg-panel-2/95 px-3 py-2 text-[12.5px] leading-snug backdrop-blur">
          <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
            {(speech.index ?? 0) + 1}/{lines.length}
          </span>
          {reading.text}
        </div>
      )}

      {error && <ErrorNote message={error} onRetry={() => setNonce((n) => n + 1)} />}

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {data && !loading && (
        <>
          {open.length + cleared.length === 0 && moves.length === 0 && (mode.kind !== "window" || settings.window !== "30d") && (
            <section className="fade-in rounded-xl border border-line/60 bg-panel p-4 text-[13px] text-muted">
              <p>
                No filings and no unusual moves {windowLabel}
                {[0, 6].includes(new Date(data.window.end).getDay()) ? ". Exchanges are shut for the weekend." : "."}
              </p>
              <button
                onClick={() => {
                  const w = mode.kind === "window" && settings.window === "7d" ? "30d" : "7d";
                  setMode({ kind: "window" });
                  onSettings({ window: w });
                }}
                className="mt-3 rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-bg"
              >
                Show the last {mode.kind === "window" && settings.window === "7d" ? "30" : "7"} days
              </button>
            </section>
          )}

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
              {critical.map((s) => card(s, alertedStories.has(s.id)))}
            </section>
          )}

          {notable.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-faint">Worth knowing</h2>
              {notable.map((s) => card(s, false))}
            </section>
          )}

          {cleared.length > 0 && (
            <section className="rounded-xl border border-line/60 bg-panel/50">
              <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-between px-3.5 py-3 text-left">
                <span className="text-[13px] font-medium text-muted">✓ {cleared.length} done</span>
                <span className="text-faint">{showDone ? "−" : "+"}</span>
              </button>
              {showDone && (
                <ul className="divide-y divide-line/60 border-t border-line/60">
                  {cleared.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 px-3.5 py-2">
                      <span className="num w-[76px] shrink-0 text-[11px] font-medium text-muted">{s.symbol}</span>
                      <span className="line-clamp-1 flex-1 text-[11.5px] text-faint">{s.headline}</span>
                      <button onClick={() => restore(s.id)} className="text-[11px] text-accent">
                        Undo
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
