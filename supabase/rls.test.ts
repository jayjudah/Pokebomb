// Runs the real migration in Postgres (PGlite) with a stand-in for Supabase's
// auth schema, then checks that one account can never see or change another
// account's cards.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const ME = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
let db: PGlite;

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
  try {
    return (await db.query(sql, params)).rows as Record<string, unknown>[];
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${ME}'), ('${OTHER}');
  `);
  await db.exec(readFileSync("supabase/migrations/001_collection.sql", "utf8"));
});

describe("collection_cards security", () => {
  it("adds copies atomically and removes them with negative deltas", async () => {
    await as(ME, `select public.add_cards($1)`, [JSON.stringify([{ id: "sv06-130", delta: 2, data: { name: "Dragapult ex" } }])]);
    await as(ME, `select public.add_cards($1)`, [JSON.stringify([{ id: "sv06-130", delta: 1 }])]);
    await as(ME, `select public.add_cards($1)`, [JSON.stringify([{ id: "sv06-130", delta: -1 }])]);
    const rows = await as(ME, "select card_id, qty, data from public.collection_cards");
    expect(rows).toEqual([{ card_id: "sv06-130", qty: 2, data: { name: "Dragapult ex" } }]);
  });

  it("ignores a retried change it has already applied", async () => {
    const op = "11111111-1111-1111-1111-111111111111";
    const items = JSON.stringify([{ id: "sv06-2", delta: 1, op }]);
    await as(ME, `select public.add_cards($1)`, [items]);
    await as(ME, `select public.add_cards($1)`, [items]);
    const [row] = await as(ME, "select qty from public.collection_cards where card_id = 'sv06-2'");
    expect(row.qty).toBe(1);
    // Another account reusing the same op id is unaffected, and can't see my op log.
    await as(OTHER, `select public.add_cards($1)`, [items]);
    expect(await as(OTHER, "select qty from public.collection_cards where card_id = 'sv06-2'")).toEqual([{ qty: 1 }]);
    expect(await as(OTHER, "select * from public.applied_ops where user_id <> auth.uid()")).toEqual([]);
  });

  it("never goes below zero", async () => {
    await as(ME, `select public.add_cards($1)`, [JSON.stringify([{ id: "sv06-1", delta: -3 }])]);
    const [row] = await as(ME, "select qty from public.collection_cards where card_id = 'sv06-1'");
    expect(row.qty).toBe(0);
  });

  it("hides my cards from another account", async () => {
    expect(await as(OTHER, `select * from public.collection_cards where user_id = '${ME}'`)).toEqual([]);
    expect(await as(OTHER, "select * from public.applied_ops where user_id <> auth.uid()")).toEqual([]);
  });

  it("stops another account from changing my cards, even naming my user id", async () => {
    await as(OTHER, "update public.collection_cards set qty = 99");
    await as(OTHER, "delete from public.collection_cards");
    await expect(
      as(OTHER, `insert into public.collection_cards (user_id, card_id, qty) values ('${ME}', 'x-1', 5)`),
    ).rejects.toThrow(/row-level security/);
    // Their add_cards writes land in their own rows, not mine.
    await as(OTHER, `select public.add_cards($1)`, [JSON.stringify([{ id: "sv06-130", delta: 50 }])]);
    const mine = await as(ME, "select qty from public.collection_cards where card_id = 'sv06-130'");
    expect(mine).toEqual([{ qty: 2 }]);
    const theirs = await as(OTHER, "select qty from public.collection_cards where card_id = 'sv06-130'");
    expect(theirs).toEqual([{ qty: 50 }]);
  });

  it("gives signed-out visitors nothing", async () => {
    await expect(as(null, "select * from public.collection_cards")).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.add_cards('[]')`)).rejects.toThrow(/permission denied/);
  });

  it("sets exact quantities for restores", async () => {
    await as(ME, `select public.set_cards($1)`, [JSON.stringify([{ id: "sv06-130", qty: 7 }, { id: "sv01-5", qty: 1 }])]);
    const rows = await as(ME, "select card_id, qty from public.collection_cards where card_id in ('sv01-5', 'sv06-130') order by card_id");
    expect(rows).toEqual([{ card_id: "sv01-5", qty: 1 }, { card_id: "sv06-130", qty: 7 }]);
  });
});
