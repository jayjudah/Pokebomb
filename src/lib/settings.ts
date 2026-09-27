import { useSyncExternalStore } from "react";
import { DEFAULT_OPTIONS, type AdvisorOptions } from "./deckAdvisor";

/** "free": image match + OCR, on device. "claude": optional paid AI read. */
export type ScanEngine = "free" | "claude";

export interface Settings extends AdvisorOptions {
  engine: ScanEngine;
  claudeApiKey: string;
  sound: boolean;
}

const KEY = "pokebomb-settings";
const DEFAULTS: Settings = { ...DEFAULT_OPTIONS, engine: "free", claudeApiKey: "", sound: true };

function load(): Settings {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    if (saved.engine !== "claude") saved.engine = "free"; // "ocr" from older versions
    return saved;
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: settings just won't persist */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
