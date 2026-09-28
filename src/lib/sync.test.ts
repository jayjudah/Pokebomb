import { describe, expect, it } from "vitest";
import { CollectionState } from "./collectionState";
import { cardData, newOpId, type Batch, type Op, type Row } from "./ops";
import { SyncEngine, type Backend } from "./sync";
import type { CardInfo } from "./types";

/** In-memory stand-in for the Supabase functions, same semantics as the SQL. */
class FakeServer {
  rows = new Map<string, Row>();
  applied = new Set<string>();
  down = false;
  failAfterApply = false; // apply succeeds, but the response is "lost"

  backend(): Backend {
    return {
      apply: async (batch: Batch) => {
        if (this.down) throw new Error("offline");
        for (const op of batch.ops) this.applyOne(op);
        if (this.failAfterApply) {
          this.failAfterApply = false;
          throw new Error("connection reset");
        }
      },
      pull: async () => {
        if (this.down) throw new Error("offline");
        return [...this.rows.values()].filter((r) => r.qty > 0).map((r) => ({ ...r }));
      },
    };
  }

  private applyOne(op: Op) {
    if (op.kind === "add") {
      if (this.applied.has(op.op)) return;
      this.applied.add(op.op);
    }
    const row = this.rows.get(op.id) ?? { card_id: op.id, qty: 0, data: {}, added_at: new Date().toISOString() };
    row.qty = Math.max(0, op.kind === "add" ? row.qty + op.delta : op.qty);
    row.data = { ...row.data, ...cardData(op.info) };
    this.rows.set(op.id, row);
  }
}

const card = (id: string, name = id): CardInfo => ({ id, name, localId: "1", setId: "s", setName: "S", category: "Pokemon" });
const add = (id: string, delta = 1, info: CardInfo | undefined = card(id)): Op => ({ kind: "add", op: newOpId(), id, delta, info });

function device(server: FakeServer, user = "me") {
  const state = new CollectionState();
  state.signIn(user);
  const engine = new SyncEngine(server.backend(), state);
  const qty = (id: string) => state.view().find((c) => c.id === id)?.qty ?? 0;
  return { state, engine, qty };
}

describe("sync", () => {
  it("keeps both devices' scans when they scan the same card at once", async () => {
    const server = new FakeServer();
    const phone = device(server);
    const laptop = device(server);
    phone.state.apply(add("sv06-130"));
    laptop.state.apply(add("sv06-130"));
    await Promise.all([phone.engine.sync(), laptop.engine.sync()]);
    await phone.engine.sync();
    expect(phone.qty("sv06-130")).toBe(2);
    expect(laptop.qty("sv06-130")).toBe(2);
  });

  it("shows changes instantly and queues them while offline", async () => {
    const server = new FakeServer();
    const phone = device(server);
    server.down = true;
    phone.state.apply(add("a", 3));
    expect(phone.qty("a")).toBe(3);
    await phone.engine.sync();
    expect(phone.engine.state).not.toBe("idle");
    expect(phone.state.pending()).toHaveLength(1);
    server.down = false;
    await phone.engine.sync();
    expect(phone.state.pending()).toHaveLength(0);
    expect(server.rows.get("a")?.qty).toBe(3);
  });

  it("doesn't double-count a scan when the connection drops mid-request", async () => {
    const server = new FakeServer();
    const phone = device(server);
    phone.state.apply(add("a"));
    server.failAfterApply = true;
    await phone.engine.sync(); // server applied it, phone never heard back
    await phone.engine.sync(); // retry
    expect(server.rows.get("a")?.qty).toBe(1);
    expect(phone.qty("a")).toBe(1);
  });

  it("removes cards on every device", async () => {
    const server = new FakeServer();
    const phone = device(server);
    const laptop = device(server);
    phone.state.apply(add("a", 2));
    await phone.engine.sync();
    await laptop.engine.sync();
    laptop.state.apply({ kind: "add", op: newOpId(), id: "a", delta: -2 });
    await laptop.engine.sync();
    await phone.engine.sync();
    expect(phone.qty("a")).toBe(0);
    expect(phone.state.view()).toHaveLength(0);
  });

  it("merges cards scanned before signing in, once", async () => {
    const server = new FakeServer();
    const s = new CollectionState();
    s.apply(add("a", 2)); // signed out
    expect(s.signIn("me")).toBe(2);
    const engine = new SyncEngine(server.backend(), s);
    await engine.sync();
    expect(server.rows.get("a")?.qty).toBe(2);
    expect(s.signIn("me")).toBe(0); // signing in again doesn't re-add
    await engine.sync();
    expect(server.rows.get("a")?.qty).toBe(2);
  });

  it("drops another account's cached cards when switching accounts", () => {
    const s = new CollectionState();
    s.signIn("me");
    s.apply(add("a"));
    s.signIn("someone-else");
    expect(s.view()).toEqual([]);
    expect(s.pending()).toEqual([]);
  });

  it("forgets everything on the device when signing out", () => {
    const s = new CollectionState();
    s.signIn("me");
    s.apply(add("a"));
    s.signOut();
    expect(s.view()).toEqual([]);
    expect(CollectionState.from(s.save()).view()).toEqual([]);
  });

  it("survives an app restart with changes still queued", async () => {
    const server = new FakeServer();
    const s = new CollectionState();
    s.signIn("me");
    s.apply(add("a"));
    const restored = CollectionState.from(JSON.parse(JSON.stringify(s.save())));
    expect(restored.view()[0].qty).toBe(1);
    await new SyncEngine(server.backend(), restored).sync();
    expect(server.rows.get("a")?.qty).toBe(1);
  });

  it("reads collections saved by the previous app version", () => {
    const old = [{ ...card("a"), qty: 4, addedAt: 1 }];
    const s = CollectionState.from(old);
    expect(s.account).toBeNull();
    expect(s.view()[0].qty).toBe(4);
  });
});
