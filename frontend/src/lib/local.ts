"use client";

const LAST_SEEN = "finn.lastSeen.v1";
const DONE = "finn.done.v1";
const NOTIFIED = "finn.notified.v1";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const lastSeen = {
  get: (): string | null => readJSON<string | null>(LAST_SEEN, null),
  touch: () => writeJSON(LAST_SEEN, new Date().toISOString()),
};

function idSet(key: string, cap = 500) {
  return {
    get: (): Set<string> => new Set(readJSON<string[]>(key, [])),
    add: (ids: string[]) => {
      const cur = readJSON<string[]>(key, []);
      writeJSON(key, [...ids, ...cur.filter((x) => !ids.includes(x))].slice(0, cap));
    },
    remove: (id: string) => writeJSON(key, readJSON<string[]>(key, []).filter((x) => x !== id)),
  };
}

export const doneStories = idSet(DONE);
export const notified = idSet(NOTIFIED);
