-- 005: finanzas. Movimientos manuales de ingresos y egresos (inversión, filamento, etc.).
-- Los pedidos finalizados NO se guardan acá: la app los suma como ingresos a partir de orders.
-- Se puede ejecutar más de una vez.
create table if not exists public.finance_movements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ingreso', 'egreso')),
  category text not null check (length(trim(category)) between 1 and 60),
  description text,
  amount numeric(12,2) not null check (amount > 0),
  quantity_kg numeric(10,3) check (quantity_kg is null or quantity_kg > 0),
  movement_date date not null default current_date,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_movements_date_idx on public.finance_movements(movement_date desc);
-- Para sumar los pedidos finalizados por fecha de finalización.
create index if not exists orders_completed_at_idx on public.orders(completed_at) where status = 'Finalizado';

drop trigger if exists finance_movements_touch_updated on public.finance_movements;
create trigger finance_movements_touch_updated
  before update on public.finance_movements
  for each row execute function public.touch_updated_at();

alter table public.finance_movements enable row level security;

drop policy if exists "Admins manage finance movements" on public.finance_movements;
create policy "Admins manage finance movements" on public.finance_movements for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.finance_movements from public, anon;
grant select, insert, update, delete on public.finance_movements to authenticated;

notify pgrst, 'reload schema';
