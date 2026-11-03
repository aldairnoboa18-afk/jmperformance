-- 003 — Permisos para la función del servidor (/api/create-user en Vercel)
-- La clave secreta (service_role) se usa SOLO en el servidor, nunca en el navegador.
grant usage on schema public to service_role;
grant all on public.profiles, public.payments, public.attendance to service_role;
grant usage, select on sequence public.member_code_seq to service_role;
