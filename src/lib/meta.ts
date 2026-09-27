import type { MetaSnapshot } from "./types";

export async function loadMeta(): Promise<MetaSnapshot> {
  const res = await fetch(`${import.meta.env.BASE_URL}meta.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load meta.json (${res.status})`);
  return res.json();
}
