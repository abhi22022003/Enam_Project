"use client";

import { useEffect, useState } from "react";
import { api, Holding, Usage } from "@/lib/api";
import { pct, tone } from "@/lib/format";
import { enableNotifications, notifySupported } from "@/lib/notify";
import { DEFAULT_SETTINGS, Settings } from "@/lib/settings";
import { ErrorNote, Skeleton, Spark } from "./ui";

const WATCHABLE: [string, string][] = [
  ["results", "Results"],
  ["management_change", "Management change"],
  ["M&A", "M&A"],
  ["litigation", "Litigation / regulatory"],
  ["fund_raise", "Fund raise"],
  ["credit_rating", "Credit rating"],
  ["pledging", "Promoter pledging"],
  ["insider_trading", "Insider trades"],
  ["capex", "Capex"],
  ["dividend", "Dividend"],
  ["bonus_split", "Bonus / split"],
  ["press_release", "Orders & press releases"],
];

function Slider({ label, hint, value, min, max, step, unit, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px]">{label}</span>
        <span className="num text-[14px] font-semibold text-accent">
          {value}
          {unit}
        </span>
      </div>
      <p className="text-[11px] text-faint">{hint}</p>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
    </div>
  );
}

export default function WatchView({ settings, onSettings, onResearch }: { settings: Settings; onSettings: (p: Partial<Settings>) => void; onResearch: (s: string) => void }) {
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .portfolio()
      .then((r) => setHoldings(r.holdings))
      .catch((e) => setError(e.message));
  }, []);

  const toggle = (c: string) =>
    onSettings({ interests: settings.interests.includes(c) ? settings.interests.filter((x) => x !== c) : [...settings.interests, c] });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[12px] text-faint">Watch</p>
        <h1 className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight">
          You decide what&apos;s unusual. <span className="text-muted">FINN watches.</span>
        </h1>
      </header>

      <section className="space-y-5 rounded-xl border border-line bg-panel p-4">
        <Slider
          label="Volume spike"
          hint="Alert when a day's volume exceeds its 20-day average by"
          value={settings.volX}
          min={1.5}
          max={6}
          step={0.5}
          unit="×"
          onChange={(v) => onSettings({ volX: v })}
        />
        <Slider
          label="Price move"
          hint="Alert when a stock closes up or down more than"
          value={settings.movePct}
          min={1}
          max={10}
          step={0.5}
          unit="%"
          onChange={(v) => onSettings({ movePct: v })}
        />
        <div>
          <div className="text-[13px]">Filings that should alert me</div>
          <p className="text-[11px] text-faint">These get an Alert tag and rank higher in your brief.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {WATCHABLE.map(([id, label]) => {
              const on = settings.interests.includes(id);
              return (
                <button key={id} onClick={() => toggle(id)} className={`rounded-full border px-2.5 py-1 text-[11.5px] ${on ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-muted"}`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <NotifyToggle on={settings.notify} onChange={(notify) => onSettings({ notify })} />
        <button onClick={() => onSettings({ ...DEFAULT_SETTINGS, window: settings.window, notify: settings.notify })} className="text-[11px] text-faint underline">
          Reset thresholds
        </button>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-faint">Portfolio · end of day</h2>
          {holdings?.[0]?.date && <span className="num text-[10px] text-faint">{holdings[0].date}</span>}
        </div>
        {error && <ErrorNote message={error} />}
        {!holdings && !error && <Skeleton className="h-64 w-full" />}
        {holdings && (
          <ul className="divide-y divide-line/70 rounded-xl border border-line bg-panel">
            {holdings.map((h) => {
              const volHot = (h.vol_ratio ?? 0) >= settings.volX;
              const moveHot = Math.abs(h.change_pct ?? 0) >= settings.movePct;
              return (
                <li key={h.symbol}>
                  <button onClick={() => onResearch(h.symbol)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="num text-[13px] font-semibold">{h.symbol}</div>
                      <div className="truncate text-[10.5px] text-faint">{h.sector}</div>
                    </div>
                    <Spark data={h.spark ?? []} />
                    <div className="w-[84px] text-right">
                      <div className="num text-[12.5px]">{h.close?.toLocaleString("en-IN", { maximumFractionDigits: 1 }) ?? "–"}</div>
                      <div className={`num text-[11px] ${moveHot ? "font-semibold" : ""} ${tone(h.change_pct)}`}>
                        {pct(h.change_pct ?? null)}
                        {volHot && <span className="ml-1 text-warn">{h.vol_ratio?.toFixed(1)}×</span>}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CostMeter />
    </div>
  );
}

function NotifyToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = async () => {
    if (on) return onChange(false);
    if (!notifySupported()) return setMsg("This browser can't show notifications. On iPhone, add FINN to your Home Screen first.");
    const ok = await enableNotifications();
    if (ok) {
      setMsg(null);
      onChange(true);
    } else setMsg("Notifications are blocked for this site in your browser settings.");
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px]">Notify me on this device</div>
          <p className="text-[11px] text-faint">Checks every 10 minutes while FINN is open or installed; each alert fires once.</p>
        </div>
        <button onClick={toggle} role="switch" aria-checked={on} aria-label="Notify me on this device" className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-white/10"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-warn">{msg}</p>}
    </div>
  );
}

function CostMeter() {
  const [h, setH] = useState<{ llm: boolean; usage: Usage } | null>(null);
  useEffect(() => {
    api.health().then(setH).catch(() => {});
  }, []);
  if (!h) return null;
  const models = Object.entries(h.usage.by_model);
  const tokens = models.reduce((n, [, m]) => n + m.prompt_tokens + m.completion_tokens, 0);
  return (
    <section className="rounded-xl border border-line/60 p-3.5 text-[11.5px] text-faint">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest">AI usage since server start</div>
      <div className="flex gap-4">
        <span>
          <span className="num text-muted">{h.usage.calls}</span> model calls
        </span>
        <span>
          <span className="num text-muted">{h.usage.cache_hits}</span> served from cache
        </span>
        <span>
          <span className="num text-muted">{tokens.toLocaleString("en-IN")}</span> tokens
        </span>
      </div>
      {models.map(([name, m]) => (
        <div key={name} className="num mt-1 text-[10.5px]">
          {name}: {m.calls} calls · {(m.prompt_tokens + m.completion_tokens).toLocaleString("en-IN")} tokens
        </div>
      ))}
    </section>
  );
}
