-- ════════════════════════════════════════════════════════════════
--  007 — Cierres de caja (Recepción)
--  Cada trabajador cierra su caja al final del turno: total cobrado por
--  método y efectivo contado. El propietario y el admin ven todos los cierres.
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════
create table if not exists public.cash_closures (
  id             uuid primary key default gen_random_uuid(),
  day            date not null,
  scope          text not null default 'me',              -- 'me' = solo lo que cobró quien cierra · 'all' = todo el personal
  closed_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  closed_at      timestamptz not null default now(),
  totals         jsonb not null default '{}'::jsonb,      -- {"Efectivo": 70, "DeUna": 24.99, ...}
  total          numeric(10,2) not null default 0,
  count          integer not null default 0,
  cash_expected  numeric(10,2) not null default 0,
  cash_counted   numeric(10,2),
  note           text default ''
);
create index if not exists cash_closures_day_idx on public.cash_closures(day);

alter table public.cash_closures enable row level security;

drop policy if exists cash_closures_select on public.cash_closures;
create policy cash_closures_select on public.cash_closures for select
  using (public.is_owner() or closed_by = auth.uid());

drop policy if exists cash_closures_insert on public.cash_closures;
create policy cash_closures_insert on public.cash_closures for insert
  with check (public.is_staff() and closed_by = auth.uid());

drop policy if exists cash_closures_delete on public.cash_closures;
create policy cash_closures_delete on public.cash_closures for delete
  using (public.is_owner());

grant select, insert, delete on public.cash_closures to authenticated;
grant all on public.cash_closures to service_role;

-- Que la API reconozca la tabla nueva de inmediato
notify pgrst, 'reload schema';
