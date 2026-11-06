-- ════════════════════════════════════════════════════════════════
--  006 — Método de ingreso en cada asistencia
--  qr · manual · huella · facial
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════
alter table public.attendance
  add column if not exists method text not null default 'qr';

do $$ begin
  alter table public.attendance
    add constraint attendance_method_check check (method in ('qr','manual','huella','facial'));
exception when duplicate_object then null; end $$;
