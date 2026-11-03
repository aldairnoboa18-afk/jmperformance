-- ════════════════════════════════════════════════════════════════
--  JMPERFORMANCE — Base de datos (Supabase)
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run
--
--  Roles:
--    cliente      → ve solo su propia información
--    empleado     → registra clientes, pagos, renovaciones y asistencia
--    propietario  → todo lo anterior + ingresos, permisos y desactivar cuentas
-- ════════════════════════════════════════════════════════════════

-- ─── Tipos ───
do $$ begin
  create type public.user_role as enum ('cliente','empleado','propietario');
exception when duplicate_object then null; end $$;

create sequence if not exists public.member_code_seq start 1;

-- ─── Perfiles (uno por usuario) ───
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  code        text unique not null default ('JMP' || lpad(nextval('public.member_code_seq')::text, 4, '0')),
  email       text,
  full_name   text not null default '',
  phone       text default '',
  cedula      text default '',
  role        public.user_role not null default 'cliente',
  active      boolean not null default true,
  plan        text,
  start_date  date,
  end_date    date,
  routine     text default '',   -- rutina / objetivos, visible para el cliente
  created_at  timestamptz not null default now()
);

-- ─── Pagos ───
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.profiles(id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 0),
  plan        text,
  method      text default 'Transferencia',
  paid_on     date not null default current_date,
  note        text default '',
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists payments_member_idx on public.payments(member_id);
create index if not exists payments_date_idx   on public.payments(paid_on);

-- ─── Asistencia ───
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.profiles(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null
);
create index if not exists attendance_member_idx on public.attendance(member_id);
create index if not exists attendance_time_idx   on public.attendance(checked_at);

-- ─── Funciones de permisos ───
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('empleado','propietario'), false)
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'propietario', false)
$$;

-- ─── Crear perfil automáticamente al registrar un usuario ───
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, cedula)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'cedula', '')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Proteger campos sensibles ───
-- Solo el propietario cambia roles o activa/desactiva cuentas.
-- (Desde el SQL Editor de Supabase, auth.uid() es nulo y se permite: así nombras al primer propietario.)
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id or new.code <> old.code or new.email is distinct from old.email then
    raise exception 'No se puede cambiar el id, código o correo';
  end if;
  if auth.uid() is not null and not public.is_owner()
     and (new.role <> old.role or new.active <> old.active) then
    raise exception 'Solo el propietario puede cambiar permisos o desactivar cuentas';
  end if;
  if auth.uid() = old.id and (new.role <> old.role or new.active <> old.active) then
    raise exception 'No puedes cambiar tu propio permiso ni desactivar tu propia cuenta';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile
  before update on public.profiles
  for each row execute function public.guard_profile();

-- ─── Seguridad por filas (RLS) ───
alter table public.profiles   enable row level security;
alter table public.payments   enable row level security;
alter table public.attendance enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using      (public.is_owner() or (public.is_staff() and role = 'cliente'))
  with check (public.is_owner() or (public.is_staff() and role = 'cliente'));

-- payments
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (member_id = auth.uid() or public.is_staff());

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert
  with check (public.is_staff());

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments for delete
  using (public.is_owner());

-- attendance
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select
  using (member_id = auth.uid() or public.is_staff());

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert
  with check (public.is_staff());

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete
  using (public.is_owner());

-- ─── Acceso explícito para la Data API ───
-- (Necesario si "Automatically expose new tables" está desactivado. RLS sigue filtrando las filas.)
grant usage on schema public to anon, authenticated;
grant select, update                 on public.profiles   to authenticated;
grant select, insert, delete         on public.payments   to authenticated;
grant select, insert, delete         on public.attendance to authenticated;
grant execute on function public.my_role(), public.is_staff(), public.is_owner() to authenticated;

-- ════════════════════════════════════════════════════════════════
--  DESPUÉS de crear tu cuenta en portal.html, conviértete en propietario
--  ejecutando esto (cambia el correo por el tuyo):
--
--  update public.profiles set role = 'propietario' where email = 'tu@correo.com';
-- ════════════════════════════════════════════════════════════════
