-- ════════════════════════════════════════════════════════════════
--  008 — Rol "Entrenador"
--  El entrenador ve la lista de clientes y la asistencia, y puede marcar
--  la entrada (QR / manual). NO ve pagos, montos, solicitudes de pago
--  ni la caja, y no puede cobrar, renovar ni editar clientes.
--  Tiene su propio QR para marcar su ingreso (acceso de personal).
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════
alter type public.user_role add value if not exists 'entrenador';

-- "equipo" = todo el personal, incluidos entrenadores (solo lectura de clientes + asistencia)
create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role()::text in ('empleado','propietario','admin','entrenador'), false)
$$;
grant execute on function public.is_team() to authenticated;

-- Perfiles: el equipo puede ver la lista (editar sigue siendo solo de recepción/propietario/admin)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_team());

-- Asistencia: el equipo la ve y puede registrar entradas; borrar sigue siendo del propietario
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select
  using (member_id = auth.uid() or public.is_team());

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert
  with check (public.is_team());

-- payments, payment_requests y cash_closures NO cambian: siguen con is_staff()/is_owner(),
-- así que el entrenador no ve dinero.

notify pgrst, 'reload schema';
