const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {}
    throw new ApiError(r.status, msg);
  }
  return r.json();
}

export const api = {
  meta: () => req<Meta>("/api/meta"),
  health: () => req<{ ok: boolean; llm: boolean; usage: Usage }>("/api/health"),
  digest: (p: DigestParams) => {
    const q = new URLSearchParams();
    if (p.since) q.set("since", p.since);
    else if (p.start) {
      q.set("start", p.start);
      if (p.end) q.set("end", p.end);
    } else q.set("window", p.window);
    q.set("interests", p.interests.join(","));
    q.set("vol_x", String(p.volX));
    q.set("move_pct", String(p.movePct));
    return req<Digest>(`/api/digest?${q}`);
  },
  enrich: (s: Story) =>
    req<Enrichment>("/api/enrich", {
      method: "POST",
      body: JSON.stringify({ symbol: s.symbol, company: s.company, category: s.category, subtype: s.subtype, filings: s.filings }),
    }),
  portfolio: () => req<{ holdings: Holding[] }>("/api/portfolio"),
  search: (q: string) => req<{ results: { symbol: string; name: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  overview: (sym: string) => req<Overview>(`/api/research/${sym}`),
  section: <T,>(sym: string, section: string) => req<T>(`/api/research/${sym}/${section}`),
  ask: (sym: string, question: string) =>
    req<AskAnswer>(`/api/research/${sym}/ask`, { method: "POST", body: JSON.stringify({ question }) }),
};

export type Usage = { calls: number; cache_hits: number; by_model: Record<string, { calls: number; prompt_tokens: number; completion_tokens: number }> };

export type Meta = {
  portfolio: { symbol: string; name: string; sector: string }[];
  research_demo: string[];
  categories: Record<string, string>;
  default_interests: string[];
  llm: boolean;
};

export type DigestParams = { window: string; since?: string; start?: string; end?: string; interests: string[]; volX: number; movePct: number };

export type Filing = {
  id: string;
  time: string;
  subject: string;
  nse_category: string;
  url: string | null;
  file_size?: string;
  score: number;
  subtype?: string | null;
  nse_summary?: string | null;
  summary?: string | null;
  classified_by?: string;
};

export type Story = {
  id: string;
  symbol: string;
  company: string;
  category: string;
  category_label: string;
  subtype: string | null;
  score: number;
  tier: "critical" | "notable" | "routine";
  headline: string;
  subject?: string;
  gist?: string | null;
  summary: string | null;
  time: string;
  price_reaction: { date: string; change_pct: number | null; vol_ratio: number | null } | null;
  filings: Filing[];
};

export type MarketAlert = {
  id: string;
  kind: "market";
  symbol: string;
  date: string;
  close: number;
  change_pct: number | null;
  vol_ratio: number | null;
  triggers: { kind: string; text: string }[];
  context: { story_id: string; headline: string; category_label: string }[];
  unexplained: boolean;
  severity: number;
};

export type FilingAlert = { id: string; kind: "filing"; symbol: string; story_id: string; headline: string; category_label: string; time: string };

export type Digest = {
  window: { start: string; end: string; label: string };
  counts: { filings: number; stories: number; critical: number; notable: number; routine_filings: number; companies_with_news: number };
  alerts: (MarketAlert | FilingAlert)[];
  stories: Story[];
  routine: Story[];
  routine_by_category: [string, number][];
  settings: { interests: string[]; vol_x: number; move_pct: number };
};

export type ResultsRow = {
  metric: string;
  current: number | null;
  previous: number | null;
  year_ago: number | null;
  qoq_pct: number | null;
  yoy_pct: number | null;
  margin: number | null;
  margin_year_ago: number | null;
};

export type ResultsCard = {
  type: "results";
  error?: string;
  source: "filing" | "screener";
  source_url: string | null;
  source_pages?: number[];
  basis: string;
  is_lender: boolean;
  unit: string;
  periods: Record<string, { label: string }>;
  table: ResultsRow[];
  ebitda_note: string;
  note?: string;
  cross_check?: { against: string; revenue_diff_pct: number | null; pat_diff_pct: number | null; agrees: boolean };
};

export type MgmtChange = {
  person: string;
  role: string;
  change: string;
  effective_date: string | null;
  reason: string | null;
  background: string | null;
  education: string | null;
  previous_roles: string[];
  linkedin_search: string;
  source_url: string;
};

export type MgmtCard = { type: "management_change"; changes: MgmtChange[]; headline: string | null; llm?: boolean };
export type SummaryCard = { type: "summary"; summary: string | null; key_figure?: string | null; source?: string };
export type Enrichment = ResultsCard | MgmtCard | SummaryCard;

export type Holding = {
  symbol: string;
  sector: string;
  close?: number;
  date?: string;
  change_pct?: number | null;
  vol_ratio?: number | null;
  high_52w?: number;
  low_52w?: number;
  spark?: number[];
};

type Series = (number | null)[];

export type Overview = {
  symbol: string;
  name: string;
  about: string;
  sector: string | null;
  basis: string;
  is_lender: boolean;
  ratios: Record<string, string>;
  growth: Record<string, Record<string, number | null>>;
  annual: { periods: string[]; revenue: Series; ebitda: Series; opm: Series; pbt: Series; pat: Series; ttm: { revenue: number | null; pat: number | null } };
  quarterly: { periods: string[]; revenue: Series; yoy_growth: Series; ebitda: Series; opm: Series; pat: Series; source_pdfs: (string | null)[] };
  balance_sheet: {
    periods: string[];
    net_worth: Series;
    borrowings: Series;
    debt_to_equity: Series;
    wc_periods: string[];
    debtor_days: Series;
    inventory_days: Series;
    payable_days: Series;
    cash_conversion_cycle: Series;
    roce: Series;
  };
  cash: { periods: string[]; cfo: Series; fcf: Series; pat: Series; cfo_to_pat_pct: Series; cumulative_conversion_pct: number | null };
  signals: { area: string; tone: "good" | "bad" | "neutral"; text: string }[];
  documents: { transcripts: { period: string; url: string }[]; annual_reports: { title: string; url: string }[] };
  source: string;
};

export type Business = {
  one_liner: string;
  segments: { name: string; share: string | null; latest: string }[];
  drivers: string[];
  source: string;
  source_url: string;
};

export type Promises = {
  scorecard: { promise: string; made_in: string; quote: string; outcome: string; verdict: "delivered" | "partly" | "missed" | "too_early" | "unverifiable"; evidence_source: string }[];
  credibility: { delivered: number; partly: number; missed: number; summary: string };
  narrative_vs_numbers: string[];
  calls: { period: string; quarter_discussed: string; url: string; tone: string; analyst_concerns: string[] }[];
};

export type BullBear = {
  bull: { point: string; evidence: string }[];
  bear: { point: string; evidence: string }[];
  watch_next: string[];
};

export type Governance = {
  auditor: { opinion: string; key_audit_matters: string[]; emphasis_or_uncertainty: string | null };
  contingent_liabilities: { total: string | null; largest_items: string[] };
  related_party: string[];
  flags: { severity: "high" | "medium" | "low"; text: string }[];
  source: { title: string; url: string; pages: number[]; total_pages: number };
};

export type AskAnswer = { answer: string; sources: { n: number; label: string; url: string; snippet: string }[] };
