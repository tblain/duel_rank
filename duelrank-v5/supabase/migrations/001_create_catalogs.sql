create table if not exists public.catalogs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  object_type text not null default '',
  csv_json jsonb not null default '[]'::jsonb,
  item_count integer not null default 0,
  missing_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists catalogs_user_updated_idx
  on public.catalogs (user_id, updated_at desc);

alter table public.catalogs enable row level security;

drop policy if exists "catalogs_select_own" on public.catalogs;
drop policy if exists "catalogs_insert_own" on public.catalogs;
drop policy if exists "catalogs_update_own" on public.catalogs;
drop policy if exists "catalogs_delete_own" on public.catalogs;

create policy "catalogs_select_own"
  on public.catalogs for select
  using (auth.uid() = user_id);

create policy "catalogs_insert_own"
  on public.catalogs for insert
  with check (auth.uid() = user_id);

create policy "catalogs_update_own"
  on public.catalogs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "catalogs_delete_own"
  on public.catalogs for delete
  using (auth.uid() = user_id);
