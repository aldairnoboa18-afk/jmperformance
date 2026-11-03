-- ════════════════════════════════════════════════════════════════
--  002 — Rol "admin" (programador / administrador del sistema)
--  Se ejecuta en DOS partes por separado (Postgres no deja usar un
--  valor nuevo de un tipo en la misma ejecución en que se crea).
-- ════════════════════════════════════════════════════════════════

-- ───────── PARTE 1 (ejecutar sola) ─────────
alter type public.user_role add value if not exists 'admin';


-- ───────── PARTE 2 (ejecutar después) ─────────
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role()::text in ('empleado','propietario','admin'), false)
$$;

-- "owner" = permisos de propietario (propietario o admin)
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role()::text in ('propietario','admin'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role()::text = 'admin', false)
$$;
grant execute on function public.is_admin() to authenticated;

create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id or new.code <> old.code or new.email is distinct from old.email then
    raise exception 'No se puede cambiar el id, código o correo';
  end if;
  if auth.uid() is null then return new; end if;  -- SQL Editor de Supabase
  if auth.uid() = old.id and (new.role <> old.role or new.active <> old.active) then
    raise exception 'No puedes cambiar tu propio permiso ni desactivar tu propia cuenta';
  end if;
  if (new.role <> old.role or new.active <> old.active) and not public.is_owner() then
    raise exception 'Solo el propietario puede cambiar permisos o desactivar cuentas';
  end if;
  if (old.role::text in ('propietario','admin') or new.role::text in ('propietario','admin'))
     and (new.role <> old.role or new.active <> old.active) and not public.is_admin() then
    raise exception 'Solo el administrador puede asignar o quitar el rol de propietario o administrador';
  end if;
  return new;
end $$;

-- Quién puede editar qué perfil
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (
    public.is_admin()
    or (public.is_owner() and role::text <> 'admin')
    or (public.is_staff() and role = 'cliente')
  )
  with check (
    public.is_admin()
    or (public.is_owner() and role::text <> 'admin')
    or (public.is_staff() and role = 'cliente')
  );

-- El admin puede corregir pagos
grant update on public.payments to authenticated;
drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update
  using (public.is_admin()) with check (public.is_admin());

-- Tu cuenta pasa a ser admin
update public.profiles
   set role = 'admin', full_name = 'Administrador del sistema'
 where email = 'aldairnoboa18@gmail.com';
