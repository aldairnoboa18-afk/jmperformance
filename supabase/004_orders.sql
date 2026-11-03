-- 004 — Órdenes de pago en línea (PayPhone)
-- Solo el servidor (service_role) escribe aquí. El propietario y el admin pueden leerlas.
create table if not exists public.orders (
  id                  text primary key,              -- clientTransactionId enviado a PayPhone
  plan                text not null,
  base_cents          integer not null,
  surcharge_cents     integer not null default 0,
  amount_cents        integer not null,               -- total cobrado (precio + recargo)
  full_name           text,
  email               text,
  phone               text,
  cedula              text,
  member_id           uuid references public.profiles(id) on delete set null,
  status              text not null default 'pending' check (status in ('pending','processing','paid','canceled','error')),
  payphone_payment_id text,
  payphone_id         text,
  payphone_status     text,
  payphone_auth       text,
  error               text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_idx on public.orders(created_at);

alter table public.orders enable row level security;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select using (public.is_owner());

grant select on public.orders to authenticated;
grant all on public.orders to service_role;
