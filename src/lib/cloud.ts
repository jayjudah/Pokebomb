// Accounts and cross-device sync (Supabase). Sign-in is email + a 6-digit
// code: no passwords, and it works inside the iPhone home-screen app, where
// magic links would open Safari instead. Privacy is enforced by the database
// (row level security, see supabase/migrations), not by this code.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import { CLOUD_ANON_KEY, CLOUD_URL } from "../cloudConfig";
import { collectionSyncStore, onSignedIn, onSignedOut, setChangeHook } from "./collection";
import { cardData, type Batch, type Row } from "./ops";
import { SyncEngine, type Backend, type SyncState } from "./sync";

const url = import.meta.env.VITE_SUPABASE_URL || CLOUD_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || CLOUD_ANON_KEY;

const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
    : null;

export const cloudEnabled = supabase !== null;

export interface CloudStatus {
  ready: boolean;
  email: string | null;
  sync: SyncState;
  pending: number;
  lastSynced: number;
  error: string;
  merged: number; // cards merged from this device on the last sign-in
}

let status: CloudStatus = { ready: !supabase, email: null, sync: "idle", pending: 0, lastSynced: 0, error: "", merged: 0 };
const listeners = new Set<() => void>();
function update(patch: Partial<CloudStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useCloud(): CloudStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

let userId: string | null = null;
let channel: RealtimeChannel | null = null;
let timer: number | undefined;

const backend: Backend = {
  async apply(batch: Batch) {
    const items = batch.ops.map((o) =>
      o.kind === "add"
        ? { op: o.op, id: o.id, delta: o.delta, data: cardData(o.info) }
        : { id: o.id, qty: o.qty, data: cardData(o.info) },
    );
    const { error } = await supabase!.rpc(batch.kind === "add" ? "add_cards" : "set_cards", { items });
    if (error) throw new Error(error.message);
  },
  async pull() {
    const rows: Row[] = [];
    const PAGE = 1000; // the API caps each response
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase!
        .from("collection_cards")
        .select("card_id, qty, data, added_at")
        .eq("user_id", userId!)
        .gt("qty", 0)
        .order("card_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data as Row[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },
};

const engine = new SyncEngine(backend, collectionSyncStore);
engine.onState = (s) =>
  update({
    sync: s,
    pending: collectionSyncStore.pending().length,
    lastSynced: engine.lastSynced,
    error: engine.lastError,
  });

export function syncNow() {
  if (userId) void engine.sync();
}

// Batch quick scans into one request.
function scheduleSync(delay = 800) {
  clearTimeout(timer);
  timer = window.setTimeout(syncNow, delay);
}

function startLive(uid: string) {
  if (!supabase) return;
  channel = supabase
    .channel(`cards-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "collection_cards", filter: `user_id=eq.${uid}` },
      () => scheduleSync(400),
    )
    .subscribe();
}

function stopLive() {
  if (channel) void supabase?.removeChannel(channel);
  channel = null;
}

if (supabase) {
  setChangeHook(() => {
    update({ pending: collectionSyncStore.pending().length });
    if (userId) scheduleSync();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user.id ?? null;
    // Defer: Supabase warns against awaiting other calls inside this callback.
    setTimeout(async () => {
      if (uid && uid !== userId) {
        userId = uid;
        const merged = await onSignedIn(uid);
        update({ ready: true, email: session?.user.email ?? null, merged });
        stopLive();
        startLive(uid);
        syncNow();
      } else if (!uid) {
        const wasSignedIn = userId !== null;
        userId = null;
        stopLive();
        if (wasSignedIn) await onSignedOut();
        update({ ready: true, email: null, merged: 0 });
      } else {
        update({ ready: true, email: session?.user.email ?? null });
      }
    }, 0);
  });
  window.addEventListener("online", syncNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
  });
  // Belt and braces in case a live update is missed.
  setInterval(() => {
    if (document.visibilityState === "visible") syncNow();
  }, 60_000);
}

export async function sendCode(email: string) {
  const { error } = await supabase!.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function verifyCode(email: string, code: string) {
  const { error } = await supabase!.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await supabase?.auth.signOut();
}
