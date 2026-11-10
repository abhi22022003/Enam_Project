"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { api, Meta } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import BriefView from "./BriefView";
import ResearchView from "./research/ResearchView";
import WatchView from "./WatchView";

type Tab = "brief" | "research" | "watch";

const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "brief",
    label: "Brief",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16M4 12h10M4 18h7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "research",
    label: "Research",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "watch",
    label: "Watch",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 17l5-5 4 3 8-8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function parseHash(hash: string): { tab: Tab; symbol: string | null } {
  const [tab, symbol] = hash.replace("#", "").split("/");
  return { tab: (["brief", "research", "watch"].includes(tab) ? tab : "brief") as Tab, symbol: symbol ? decodeURIComponent(symbol) : null };
}

export default function App() {
  const { settings, update, loaded } = useSettings();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const { tab, symbol } = parseHash(hash);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  const go = (t: Tab, s: string | null = null) => {
    window.location.hash = t === "research" && s ? `#research/${encodeURIComponent(s)}` : `#${t}`;
    window.scrollTo({ top: 0 });
  };

  const portfolio = meta?.portfolio.map((p) => p.symbol) ?? [];

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <div className="sticky top-0 z-20 flex items-center justify-between bg-bg/90 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[12px] font-black text-bg">F</div>
          <span className="text-[14px] font-semibold tracking-tight">FINN</span>
        </div>
        {meta && !meta.llm && <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[10px] text-warn">AI enrichment off</span>}
      </div>

      <main className="px-4 pt-2 pb-[calc(96px+env(safe-area-inset-bottom))]">
        {loaded && tab === "brief" && <BriefView settings={settings} onSettings={update} onResearch={(s) => go("research", s)} />}
        {tab === "research" && (
          <ResearchView symbol={symbol} onSymbol={(s) => go("research", s)} portfolio={portfolio} demo={meta?.research_demo ?? []} llm={meta?.llm ?? false} />
        )}
        {loaded && tab === "watch" && <WatchView settings={settings} onSettings={update} onResearch={(s) => go("research", s)} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-md">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id, n.id === "research" ? symbol : null)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-medium ${tab === n.id ? "text-ink" : "text-faint"}`}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
