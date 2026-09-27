-- Pokebomb: one row per card per account. Row Level Security means the
-- database itself refuses to show or change rows that belong to another
-- account, no matter what the app sends.

create table if not exists public.collection_cards (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  card_id    text        not null check (length(card_id) between 1 and 64),
  qty        integer     not null default 0 check (qty >= 0 and qty <= 100000),
  data       jsonb       not null default '{}'::jsonb check (pg_column_size(data) < 8192),
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table public.collection_cards enable row level security;

drop policy if exists "own rows: read" on public.collection_cards;
drop policy if exists "own rows: insert" on public.collection_cards;
drop policy if exists "own rows: update" on public.collection_cards;
drop policy if exists "own rows: delete" on public.collection_cards;
create policy "own rows: read"   on public.collection_cards for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.collection_cards for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.collection_cards for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.collection_cards for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.collection_cards from anon;
grant select, insert, update, delete on public.collection_cards to authenticated;

-- Ids of changes already applied, so a retry after a dropped connection
-- can't count the same scan twice.
create table if not exists public.applied_ops (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  op_id      uuid        not null,
  applied_at timestamptz not null default now(),
  primary key (user_id, op_id)
);
alter table public.applied_ops enable row level security;
drop policy if exists "own ops" on public.applied_ops;
create policy "own ops" on public.applied_ops for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.applied_ops from anon;
grant select, insert, delete on public.applied_ops to authenticated;

-- Add (or remove, with a negative delta) copies atomically, so two devices
-- scanning at once never lose a copy. items: [{ "id": "sv06-130", "delta": 1, "data": {...} }]
-- security invoker: runs as the caller, so the policies above still apply.
create or replace function public.add_cards(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  x jsonb;
begin
  if jsonb_array_length(items) > 5000 then
    raise exception 'too many items';
  end if;
  delete from public.applied_ops where user_id = auth.uid() and applied_at < now() - interval '30 days';
  for x in select * from jsonb_array_elements(items) loop
    if x ? 'op' then
      insert into public.applied_ops (user_id, op_id) values (auth.uid(), (x ->> 'op')::uuid)
      on conflict do nothing;
      if not found then
        continue; -- already applied
      end if;
    end if;
    update public.collection_cards
       set qty = greatest(0, qty + (x ->> 'delta')::int),
           data = data || coalesce(x -> 'data', '{}'::jsonb),
           updated_at = now()
     where user_id = auth.uid() and card_id = x ->> 'id';
    if not found then
      insert into public.collection_cards (user_id, card_id, qty, data)
      values (auth.uid(), x ->> 'id', greatest(0, (x ->> 'delta')::int), coalesce(x -> 'data', '{}'::jsonb))
      on conflict (user_id, card_id) do update
        set qty = greatest(0, public.collection_cards.qty + (x ->> 'delta')::int),
            data = public.collection_cards.data || excluded.data,
            updated_at = now();
    end if;
  end loop;
end;
$$;

-- Set exact quantities (restore a backup, clear the collection).
create or replace function public.set_cards(items jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.collection_cards as c (user_id, card_id, qty, data)
  select auth.uid(), x ->> 'id', greatest(0, (x ->> 'qty')::int), coalesce(x -> 'data', '{}'::jsonb)
  from jsonb_array_elements(items) as x
  on conflict (user_id, card_id) do update
    set qty = excluded.qty,
        data = c.data || excluded.data,
        updated_at = now();
$$;

revoke all on function public.add_cards(jsonb) from public, anon;
revoke all on function public.set_cards(jsonb) from public, anon;
grant execute on function public.add_cards(jsonb) to authenticated;
grant execute on function public.set_cards(jsonb) to authenticated;

-- Live updates between devices (Realtime also enforces the policies above).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'collection_cards') then
    alter publication supabase_realtime add table public.collection_cards;
  end if;
end $$;
