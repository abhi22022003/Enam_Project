import type { Digest, MarketAlert, ResultsCard, Story } from "./api";
import { enrichCache } from "./enrichCache";

export type Line = { text: string; storyId?: string };

export const shortName = (company: string) =>
  company
    .replace(/\b(Limited|Ltd\.?|Company|Corporation|Industries|India)\b/gi, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

const spokenPct = (v: number) => `${Math.abs(v) < 10 ? Math.abs(v).toFixed(1).replace(/\.0$/, "") : Math.round(Math.abs(v))} percent`;

const indianNumber = (raw: string) => {
  const n = Number(raw.replace(/,/g, ""));
  if (n >= 1e7) return `${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, "")} crore`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1).replace(/\.0$/, "")} lakh`;
  return raw;
};

const speakable = (s: string) =>
  s
    .replace(/\b\d{1,3}(?:,\d{2})+,\d{3}\b/g, indianNumber)
    .replace(/\s+at its meeting held on [^,.;]+(?:, \d{4})?/i, "")
    .replace(/\bpursuant to\b/gi, "via")
    .replace(/\bRs\.?\s?/g, "rupees ");

const firstClause = (s: string, words = 16) => {
  const clause = speakable(s).split(/(?<!\b(?:Mr|Ms|Mrs|Dr|Shri|Smt|No|Ltd|Co|Inc|St|Pvt|[A-Z]))\.\s+(?=[A-Z])|;\s|\s[-–]\s/)[0];
  const w = clause.split(/\s+/);
  if (w.length <= words) return clause.replace(/\.$/, "");
  const cut = w.slice(0, words).join(" ");
  const comma = cut.lastIndexOf(",");
  return comma > cut.length / 2 ? cut.slice(0, comma) : cut;
};

function reaction(s: Story): string {
  const r = s.price_reaction;
  if (!r || r.change_pct == null || Math.abs(r.change_pct) < 1.5) return "";
  const vol = r.vol_ratio != null && r.vol_ratio >= 1.8 ? ` on ${r.vol_ratio.toFixed(1)} times normal volume` : "";
  return ` The stock ${r.change_pct > 0 ? "rose" : "fell"} ${spokenPct(r.change_pct)}${vol}.`;
}

function resultsLine(name: string, s: Story, card: ResultsCard): string {
  const row = (m: string) => card.table.find((r) => r.metric === m);
  const rev = row("Revenue");
  const pat = row("PAT");
  const parts: string[] = [];
  if (rev?.yoy_pct != null) parts.push(`revenue ${rev.yoy_pct >= 0 ? "up" : "down"} ${spokenPct(rev.yoy_pct)}`);
  if (pat?.yoy_pct != null) parts.push(`profit after tax ${pat.yoy_pct >= 0 ? "up" : "down"} ${spokenPct(pat.yoy_pct)}`);
  const head = s.headline.replace(/ filed$/, "");
  return `${name} reported ${head}${parts.length ? `: ${parts.join(", ")} from a year ago` : ""}.`;
}

function storyLine(s: Story, names: Map<string, string>): string {
  const name = names.get(s.symbol) ?? shortName(s.company);
  const e = enrichCache.get(s.id);
  if (e?.type === "results" && !e.error && e.table?.length) return resultsLine(name, s, e) + reaction(s);
  if (e?.type === "management_change" && e.headline) return `${name}: ${e.headline}.` + reaction(s);
  return `${name}, ${s.category_label.toLowerCase()}: ${firstClause(s.headline, 16)}.` + reaction(s);
}

function moveLine(a: MarketAlert, names: Map<string, string>): string {
  const name = names.get(a.symbol) ?? a.symbol;
  const dir = (a.change_pct ?? 0) >= 0 ? "rose" : "fell";
  const vol = a.vol_ratio != null && a.vol_ratio >= 1.8 ? ` on ${a.vol_ratio.toFixed(1)} times its usual volume` : "";
  const move = a.change_pct != null && Math.abs(a.change_pct) >= 1 ? `${name} ${dir} ${spokenPct(a.change_pct)}${vol}` : `${name} traded${vol || " unusually"}`;
  return `${move}, and no filing explains it.`;
}

export function buildBrief(d: Digest, names: Map<string, string>, windowLabel: string, done: Set<string>): Line[] {
  const open = d.stories.filter((s) => !done.has(s.id));
  const critical = open.filter((s) => s.tier === "critical").slice(0, 4);
  const notable = open.filter((s) => s.tier === "notable");
  const lines: Line[] = [];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
  lines.push({
    text: `${hello} ${windowLabel[0].toUpperCase()}${windowLabel.slice(1)}, I read ${d.counts.filings} filings across your holdings. ${
      critical.length ? `${critical.length} need${critical.length === 1 ? "s" : ""} your attention.` : "Nothing needs your attention."
    }`,
  });
  for (const s of critical) lines.push({ text: storyLine(s, names), storyId: s.id });
  const unexplained = (d.alerts.filter((a) => a.kind === "market") as MarketAlert[]).filter((a) => a.unexplained).slice(0, 2);
  for (const a of unexplained) lines.push({ text: moveLine(a, names) });
  const tail: string[] = [];
  if (notable.length) tail.push(`${notable.length} smaller item${notable.length > 1 ? "s" : ""} worth a glance`);
  if (d.counts.routine_filings) tail.push(`${d.counts.routine_filings} routine filings you can skip`);
  lines.push({ text: `${tail.length ? `There are also ${tail.join(", and ")}. ` : ""}That's your brief.` });
  return lines;
}

export function estimateSeconds(lines: Line[]): number {
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  return Math.max(10, Math.round(words / 2.6));
}

export function pickVoice(): SpeechSynthesisVoice | null {
  const voices = typeof window !== "undefined" ? window.speechSynthesis?.getVoices() ?? [] : [];
  return (
    voices.find((v) => v.lang === "en-IN") ??
    voices.find((v) => v.lang === "en-GB" && /female|serena|kate|martha/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}
