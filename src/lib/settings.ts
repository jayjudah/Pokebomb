import { useSyncExternalStore } from "react";
import { DEFAULT_OPTIONS, type AdvisorOptions } from "./deckAdvisor";

export type ScanEngine = "ocr" | "claude";

export interface Settings extends AdvisorOptions {
  engine: ScanEngine;
  claudeApiKey: string;
  sound: boolean;
}

const KEY = "pokebomb-settings";
const DEFAULTS: Settings = { ...DEFAULT_OPTIONS, engine: "ocr", claudeApiKey: "", sound: true };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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
