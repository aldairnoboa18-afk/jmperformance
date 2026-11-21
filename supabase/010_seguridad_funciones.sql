-- ════════════════════════════════════════════════════════════════
--  010 — Endurecer permisos (avisos del Security Advisor de Supabase)
--  · Las funciones de trigger no se pueden llamar por la API.
--  · Las funciones de rol (is_*, my_role) y approve_payment_request
--    solo para usuarios con sesión (las políticas RLS las necesitan).
--  · Visitantes sin sesión (anon) no ejecutan ninguna función.
--  · Nadie desde la web puede usar TRUNCATE (se salta RLS).
--  No cambia nada de lo que hace la web hoy.
-- ════════════════════════════════════════════════════════════════

-- 1) Funciones de trigger: solo las dispara la base de datos
revoke execute on function public.guard_profile()   from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 2) Funciones usadas por RLS y por Recepción: solo con sesión iniciada
revoke execute on function public.my_role()  from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_team()  from public, anon;
revoke execute on function public.approve_payment_request(uuid, date, date, numeric) from public, anon;

grant execute on function public.my_role(), public.is_admin(), public.is_owner(),
                          public.is_staff(), public.is_team(),
                          public.approve_payment_request(uuid, date, date, numeric)
  to authenticated, service_role;

-- 3) TRUNCATE borra tablas enteras saltándose RLS: fuera para la web
revoke truncate on all tables in schema public from anon, authenticated;

notify pgrst, 'reload schema';
