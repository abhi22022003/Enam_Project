"use client";

import { api, FilingAlert, MarketAlert } from "./api";
import { notified } from "./local";
import { Settings } from "./settings";

export const notifySupported = () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

export async function enableNotifications(): Promise<boolean> {
  if (!notifySupported()) return false;
  await registration();
  const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  return p === "granted";
}

function describe(a: FilingAlert | MarketAlert, names: Map<string, string>): { title: string; body: string } {
  const name = names.get(a.symbol) ?? a.symbol;
  if (a.kind === "filing") return { title: `${name} · ${a.category_label}`, body: a.headline };
  const why = a.unexplained ? "No filing explains this move." : `Likely: ${a.context[0]?.headline}`;
  return { title: `${name} · ${a.triggers.map((t) => t.text).join(", ")}`, body: why };
}

export async function checkAndNotify(settings: Settings, names: Map<string, string>): Promise<number> {
  if (!notifySupported() || Notification.permission !== "granted") return 0;
  const d = await api.digest({ window: "24h", interests: settings.interests, volX: settings.volX, movePct: settings.movePct });
  const seen = notified.get();
  const fresh = d.alerts.filter((a) => !seen.has(a.id));
  if (!fresh.length) return 0;
  const reg = await registration();
  for (const a of fresh.slice(0, 3)) {
    const { title, body } = describe(a, names);
    await reg.showNotification(title, {
      body,
      tag: a.id,
      icon: "/icon",
      data: { url: a.kind === "filing" ? "/#brief" : `/#research/${a.symbol}` },
    });
  }
  if (fresh.length > 3) {
    await reg.showNotification(`FINN · ${fresh.length - 3} more alerts`, { body: "Open your brief to see them.", tag: "finn-more", data: { url: "/#brief" } });
  }
  notified.add(fresh.map((a) => a.id));
  return fresh.length;
}
