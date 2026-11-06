-- ════════════════════════════════════════════════════════════════
--  005 — Pagos por transferencia enviados desde el portal
--  El cliente sube su comprobante → queda "pendiente" → recepción lo
--  aprueba (se registra el pago y se activa/extiende la membresía) o lo rechaza.
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════

create table if not exists public.payment_requests (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  plan         text not null,
  amount       numeric(10,2) not null check (amount >= 0),
  method       text not null default 'Transferencia',
  reference    text not null default '',                       -- n.º de comprobante (opcional)
  proof        text not null check (length(proof) <= 1500000), -- imagen comprimida (data URL)
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note   text not null default '',
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists payment_requests_status_idx on public.payment_requests(status, created_at);
create index if not exists payment_requests_member_idx on public.payment_requests(member_id);
-- Solo una solicitud pendiente por cliente (evita envíos repetidos)
create unique index if not exists payment_requests_one_pending
  on public.payment_requests(member_id) where status = 'pending';

alter table public.payment_requests enable row level security;

-- El cliente ve las suyas; el personal ve todas
drop policy if exists payreq_select on public.payment_requests;
create policy payreq_select on public.payment_requests for select
  using (member_id = auth.uid() or public.is_staff());

-- El cliente solo puede crear solicitudes propias y pendientes
drop policy if exists payreq_insert on public.payment_requests;
create policy payreq_insert on public.payment_requests for insert
  with check (member_id = auth.uid() and status = 'pending' and reviewed_by is null
              and reviewed_at is null and admin_note = '');

-- Solo el personal las procesa
drop policy if exists payreq_update on public.payment_requests;
create policy payreq_update on public.payment_requests for update
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists payreq_delete on public.payment_requests;
create policy payreq_delete on public.payment_requests for delete
  using (public.is_owner());

grant select, insert, update, delete on public.payment_requests to authenticated;

-- Aprobar en un solo paso (todo o nada): registra el pago, activa/extiende y marca aprobada.
-- p_start = null → conserva la fecha de inicio actual (renovación de una membresía vigente).
create or replace function public.approve_payment_request(req_id uuid, p_start date, p_end date, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare r public.payment_requests; m public.profiles;
begin
  if not public.is_staff() then raise exception 'No tienes permiso'; end if;
  if p_end is null then raise exception 'Falta la fecha de vencimiento'; end if;
  select * into r from public.payment_requests where id = req_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if r.status <> 'pending' then raise exception 'Esta solicitud ya fue procesada'; end if;
  select * into m from public.profiles where id = r.member_id;
  insert into public.payments (member_id, amount, plan, method, note, created_by)
  values (r.member_id, coalesce(p_amount, r.amount), r.plan, r.method,
          case when m.end_date is null then 'Inscripción' else 'Renovación' end, auth.uid());
  update public.profiles
     set plan = r.plan, start_date = coalesce(p_start, start_date), end_date = p_end
   where id = r.member_id;
  update public.payment_requests
     set status = 'approved', amount = coalesce(p_amount, r.amount), reviewed_by = auth.uid(), reviewed_at = now()
   where id = req_id;
end $$;

revoke all on function public.approve_payment_request(uuid, date, date, numeric) from public, anon;
grant execute on function public.approve_payment_request(uuid, date, date, numeric) to authenticated;
