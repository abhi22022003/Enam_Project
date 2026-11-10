export function crore(v: number | null | undefined): string {
  if (v == null) return "–";
  const abs = Math.abs(v);
  if (abs >= 100000) return `${(v / 100000).toFixed(2)}L`;
  if (abs >= 1000) return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export function pct(v: number | null | undefined, digits = 1, sign = true): string {
  if (v == null || Number.isNaN(v)) return "–";
  const s = v.toFixed(digits);
  return `${sign && v > 0 ? "+" : ""}${s}%`;
}

export function tone(v: number | null | undefined): string {
  if (v == null) return "text-muted";
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-muted";
}

export function ago(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
