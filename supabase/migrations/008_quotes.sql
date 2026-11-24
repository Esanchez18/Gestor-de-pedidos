-- 008: presupuestos en PDF. Se puede ejecutar más de una vez.

-- Datos del negocio y condiciones por defecto (una fila por clave, compartida entre dispositivos).
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists app_settings_touch_updated on public.app_settings;
create trigger app_settings_touch_updated before update on public.app_settings
  for each row execute function public.touch_updated_at();

alter table public.app_settings enable row level security;
drop policy if exists "Admins manage settings" on public.app_settings;
create policy "Admins manage settings" on public.app_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.app_settings from public, anon;
grant select, insert, update, delete on public.app_settings to authenticated;

-- Presupuestos emitidos: número correlativo y copia de lo que se envió al cliente.
create sequence if not exists public.quote_number_seq start 1;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique default ('PRES-' || lpad(nextval('public.quote_number_seq')::text, 5, '0')),
  order_id uuid references public.orders(id) on delete set null,
  customer_name text not null,
  total numeric(12,2) not null default 0 check (total >= 0),
  valid_until date,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists quotes_created_idx on public.quotes(created_at desc);
create index if not exists quotes_order_idx on public.quotes(order_id);

alter table public.quotes enable row level security;
drop policy if exists "Admins manage quotes" on public.quotes;
create policy "Admins manage quotes" on public.quotes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.quotes from public, anon;
grant select, insert, update, delete on public.quotes to authenticated;
grant usage on sequence public.quote_number_seq to authenticated;

notify pgrst, 'reload schema';
