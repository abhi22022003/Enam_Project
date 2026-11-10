"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export type Settings = {
  interests: string[];
  volX: number;
  movePct: number;
  window: string;
};

export const DEFAULT_SETTINGS: Settings = {
  interests: ["results", "M&A", "management_change", "litigation", "fund_raise", "credit_rating", "pledging"],
  volX: 2,
  movePct: 4,
  window: "24h",
};

const KEY = "finn.settings.v1";
const EVENT = "finn-settings";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const read = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

export function useSettings() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const settings = useMemo<Settings>(() => {
    if (!raw) return DEFAULT_SETTINGS;
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }, [raw]);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...settings, ...patch }));
      } catch {}
      window.dispatchEvent(new Event(EVENT));
    },
    [settings],
  );

  return { settings, update, loaded: raw !== null };
}
