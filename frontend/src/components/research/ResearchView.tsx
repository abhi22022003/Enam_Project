"use client";

import { useEffect, useRef, useState } from "react";
import { api, AskAnswer, Overview } from "@/lib/api";
import { ErrorNote, Sheet, Skeleton } from "../ui";
import { BullBearSection, BusinessSection, GovernanceSection, NumbersSection, PromisesSection, SignalList } from "./sections";

const TABS = [
  { id: "promises", label: "Promised vs delivered" },
  { id: "business", label: "Business" },
  { id: "numbers", label: "Numbers" },
  { id: "bullbear", label: "Bull / Bear" },
  { id: "governance", label: "Annual report" },
];

function Search({ onPick, portfolio, demo }: { onPick: (s: string) => void; portfolio: string[]; demo: string[] }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; results: { symbol: string; name: string }[] }>({ q: "", results: [] });
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => api.search(q).then((r) => setFound({ q, results: r.results })).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = q.trim().length >= 2 && found.q === q ? found.results : [];
  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) onPick(results[0]?.symbol ?? q.trim().toUpperCase());
          }}
          placeholder="Any NSE company or ticker…"
          className="w-full rounded-xl border border-line bg-panel px-3.5 py-3 text-[14px] outline-none placeholder:text-faint focus:border-accent/60"
        />
        {results.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-panel-2 shadow-xl">
            {results.map((r) => (
              <li key={r.symbol}>
                <button onClick={() => onPick(r.symbol)} className="flex w-full items-baseline gap-2 px-3.5 py-2.5 text-left hover:bg-white/5">
                  <span className="num text-[12px] font-semibold">{r.symbol}</span>
                  <span className="truncate text-[12px] text-muted">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-faint">Try outside your portfolio</div>
        <div className="flex flex-wrap gap-1.5">
          {demo.map((s) => (
            <button key={s} onClick={() => onPick(s)} className="num rounded-full border border-accent/40 px-2.5 py-1 text-[11px] text-accent">
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-faint">Your portfolio</div>
        <div className="flex flex-wrap gap-1.5">
          {portfolio.map((s) => (
            <button key={s} onClick={() => onPick(s)} className="num rounded-full bg-panel px-2.5 py-1 text-[11px] text-muted">
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type Msg = { role: "user" | "finn"; text: string; sources?: AskAnswer["sources"] };

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};

function MicButton({ onText, disabled }: { onText: (t: string) => void; disabled: boolean }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const Ctor =
    typeof window !== "undefined"
      ? ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition)
      : undefined;
  if (!Ctor) return null;
  const toggle = () => {
    if (listening) return rec.current?.stop();
    const r = new Ctor();
    r.lang = "en-IN";
    r.interimResults = false;
    r.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript;
      if (text) onText(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={listening ? "Stop listening" : "Ask by voice"}
      className={`flex w-10 shrink-0 items-center justify-center rounded-xl border ${listening ? "animate-pulse border-down bg-down/20 text-down" : "border-line text-muted"} disabled:opacity-50`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function AskSheet({ symbol, open, onClose }: { symbol: string; open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await api.ask(symbol, question);
      setMsgs((m) => [...m, { role: "finn", text: r.answer, sources: r.sources }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "finn", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  const suggestions = ["What did management guide for margins?", "Why did growth slow?", "What are analysts worried about?", "How much capex is planned?"];

  return (
    <Sheet open={open} onClose={onClose} title={<span>Ask about <span className="num">{symbol}</span></span>}>
      <p className="mb-3 text-[11px] text-faint">Answers come only from the last 4 earnings-call transcripts and reported financials, with citations.</p>
      <div className="space-y-3">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted">
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-10 rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-[13px]" : "text-[13px] leading-relaxed"}>
            <div className="whitespace-pre-wrap">{m.text}</div>
            {m.sources && (
              <details className="mt-1.5 text-[11px] text-faint">
                <summary className="cursor-pointer">{m.sources.length} sources</summary>
                <ol className="mt-1 space-y-1">
                  {m.sources.map((s) => (
                    <li key={s.n}>
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-muted">
                        [{s.n}] {s.label}
                      </a>
                      <div className="line-clamp-2 text-faint">{s.snippet}</div>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        ))}
        {busy && <Skeleton className="h-12 w-4/5" />}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
        className="sticky bottom-0 mt-3 flex gap-2 bg-panel pt-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about the calls…" className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-[13px] outline-none focus:border-accent/60" />
        <MicButton onText={send} disabled={busy} />
        <button disabled={busy} className="rounded-xl bg-accent px-3.5 text-[13px] font-medium text-bg disabled:opacity-50">
          Ask
        </button>
      </form>
    </Sheet>
  );
}

export default function ResearchView({
  symbol,
  onSymbol,
  portfolio,
  demo,
  llm,
}: {
  symbol: string | null;
  onSymbol: (s: string | null) => void;
  portfolio: string[];
  demo: string[];
  llm: boolean;
}) {
  if (!symbol) {
    return (
      <div className="space-y-5">
        <header>
          <p className="text-[12px] text-faint">Research</p>
          <h1 className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight">
            Don&apos;t summarise management. <span className="text-muted">Check them.</span>
          </h1>
          <p className="mt-1 text-[12px] text-faint">Built only from earnings-call transcripts, annual reports and reported financials. No news, no broker notes.</p>
        </header>
        <Search onPick={onSymbol} portfolio={portfolio} demo={demo} />
      </div>
    );
  }

  return <Dossier key={symbol} symbol={symbol} onSymbol={onSymbol} llm={llm} />;
}

function Dossier({ symbol, onSymbol, llm }: { symbol: string; onSymbol: (s: string | null) => void; llm: boolean }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setTab] = useState<string | null>(null);
  const tab = picked ?? (llm ? "promises" : "numbers");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .overview(symbol)
      .then((d) => alive && setOv(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [symbol]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => onSymbol(null)} className="text-[12px] text-muted">
          ← Search
        </button>
      </div>
      {error && <ErrorNote message={error} />}
      {!ov && !error && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {ov && (
        <>
          <header>
            <div className="flex items-baseline gap-2">
              <h1 className="text-[20px] font-semibold leading-tight tracking-tight">{ov.name}</h1>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
              <span className="num">{ov.symbol}</span>
              {ov.ratios["Current Price"] && <span className="num">{ov.ratios["Current Price"]}</span>}
              {ov.ratios["Market Cap"] && <span className="num">MCap {ov.ratios["Market Cap"].replace("Cr.", "Cr")}</span>}
              {ov.ratios["Stock P/E"] && <span className="num">P/E {ov.ratios["Stock P/E"]}</span>}
            </div>
          </header>

          {ov.signals.length > 0 && (
            <section className="rounded-xl border border-line bg-panel p-3">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">What the numbers say</div>
              <SignalList items={ov.signals.slice(0, 5)} />
            </section>
          )}

          <nav className="no-scrollbar sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto bg-bg/95 px-4 py-2 backdrop-blur">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium ${tab === t.id ? "bg-ink text-bg" : "bg-panel text-muted"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="fade-in" key={tab}>
            {!llm && tab !== "numbers" ? (
              <ErrorNote message="This section needs an LLM key on the server (GEMINI_API_KEY). The Numbers tab works without it." />
            ) : tab === "promises" ? (
              <PromisesSection symbol={ov.symbol} />
            ) : tab === "business" ? (
              <BusinessSection symbol={ov.symbol} ov={ov} />
            ) : tab === "numbers" ? (
              <NumbersSection ov={ov} />
            ) : tab === "bullbear" ? (
              <BullBearSection symbol={ov.symbol} />
            ) : (
              <GovernanceSection symbol={ov.symbol} />
            )}
          </div>

          {llm && (
            <button
              onClick={() => setAsking(true)}
              className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-bg shadow-lg shadow-black/50"
            >
              Ask about {ov.symbol}
            </button>
          )}
          <AskSheet symbol={ov.symbol} open={asking} onClose={() => setAsking(false)} />
        </>
      )}
    </div>
  );
}
