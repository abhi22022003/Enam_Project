"use client";

import { ReactNode, useEffect } from "react";

export function Spark({ data, width = 72, height = 24 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / span) * (height - 2) - 1}`);
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Bars({
  labels,
  values,
  height = 64,
  format = (v: number) => String(v),
  highlightLast = true,
  line,
  annual = false,
}: {
  annual?: boolean;
  labels: string[];
  values: (number | null)[];
  height?: number;
  format?: (v: number) => string;
  highlightLast?: boolean;
  line?: (number | null)[];
}) {
  const nums = values.map((v) => v ?? 0);
  const max = Math.max(...nums.map(Math.abs), 1);
  const lmax = line ? Math.max(...line.map((v) => v ?? 0), 1) : 1;
  const lmin = line ? Math.min(...line.map((v) => v ?? 0)) : 0;
  const n = values.length;
  return (
    <div className="w-full">
      <div className="relative flex items-end gap-1" style={{ height }}>
        {values.map((v, i) => {
          const h = v == null ? 0 : (Math.abs(v) / max) * (height - 14);
          const last = highlightLast && i === n - 1;
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end" style={{ height }}>
              <span className={`num mb-0.5 text-[9px] ${last ? "text-ink" : "text-faint"}`}>{v == null ? "" : format(v)}</span>
              <div
                className={`w-full rounded-sm ${v != null && v < 0 ? "bg-down/70" : last ? "bg-accent" : "bg-accent/35"}`}
                style={{ height: Math.max(h, v == null ? 0 : 2) }}
              />
            </div>
          );
        })}
        {line && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${n * 10} ${height}`} preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke="var(--color-warn)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              points={line
                .map((v, i) => `${i * 10 + 5},${height - 16 - (((v ?? lmin) - lmin) / (lmax - lmin || 1)) * (height - 30)}`)
                .join(" ")}
            />
          </svg>
        )}
      </div>
      <div className="mt-1 flex gap-1">
        {labels.map((l, i) => (
          <span key={i} className="num flex-1 truncate text-center text-[9px] text-faint">
            {annual ? l.replace(/^Mar \d{2}(\d{2})$/, "FY$1") : l.replace(/^(\w{3}) \d{2}(\d{2})$/, "$1'$2")}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-md ${className}`} />;
}

export function Tag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}>{children}</span>;
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fade-in relative flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-2xl border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-full px-2 py-1 text-xs text-muted hover:text-ink">
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 text-accent">
          Retry
        </button>
      )}
    </div>
  );
}
