-- ════════════════════════════════════════════════════════════════
--  009 — Pase diario (visitantes sin cuenta)
--  Recepción cobra el pase diario solo con el nombre del visitante:
--  el cobro va a "payments" y la entrada a "attendance" sin cliente
--  asociado (member_id vacío) y con visitor_name.
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════
alter table public.payments   alter column member_id drop not null;
alter table public.payments   add column if not exists visitor_name text;
alter table public.attendance alter column member_id drop not null;
alter table public.attendance add column if not exists visitor_name text;

-- Cada fila debe tener un cliente o el nombre de un visitante
do $$ begin
  alter table public.payments add constraint payments_who_check
    check (member_id is not null or coalesce(trim(visitor_name), '') <> '');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.attendance add constraint attendance_who_check
    check (member_id is not null or coalesce(trim(visitor_name), '') <> '');
exception when duplicate_object then null; end $$;

-- Los permisos no cambian: cobrar sigue siendo solo de recepción/propietario/admin (is_staff),
-- y un cliente solo ve sus propios pagos (member_id = su id), nunca los de visitantes.

notify pgrst, 'reload schema';
