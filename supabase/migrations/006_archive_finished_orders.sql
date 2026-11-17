-- 006: archivar pedidos finalizados (sin borrarlos).
-- Los pedidos en estado "Finalizado" hace más de 7 días se marcan con archived_at:
-- dejan de aparecer en Inicio y Pedidos, pero siguen en Historial y suman en Finanzas.
-- Los finalizados SIN precio cotizado no se archivan, para que puedas completarlos.
-- Si un pedido archivado cambia de estado (por ejemplo, se reactiva), vuelve a Pedidos.
-- La app llama a archive_finished_orders() al abrirse. Se puede ejecutar más de una vez.

alter table public.orders add column if not exists archived_at timestamptz;
create index if not exists orders_active_idx on public.orders(created_at desc) where archived_at is null;

-- Al salir de "Finalizado", el pedido deja de estar archivado.
create or replace function public.unarchive_on_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from 'Finalizado' then
    new.archived_at = null;
  end if;
  return new;
end $$;

drop trigger if exists orders_unarchive on public.orders;
create trigger orders_unarchive before insert or update on public.orders
  for each row execute function public.unarchive_on_status_change();

-- Historial de actividad: registra el archivado y no anota cambios vacíos.
create or replace function public.audit_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_activity(order_id, event_type, description, user_id)
    values (new.id, 'created', 'Se creó el pedido ' || new.order_number || '.', auth.uid());
  elsif (to_jsonb(new) - 'updated_at' - 'completed_at') = (to_jsonb(old) - 'updated_at' - 'completed_at') then
    return new;
  elsif new.status is distinct from old.status then
    insert into public.order_activity(order_id, event_type, description, user_id)
    values (new.id,
      case when new.status = 'Finalizado' then 'completed'
           when new.status = 'Cancelado' then 'cancelled'
           when old.status = 'Cancelado' then 'reactivated'
           else 'status_changed' end,
      'Estado actualizado de ' || old.status || ' a ' || new.status || '.', auth.uid());
  elsif old.archived_at is null and new.archived_at is not null then
    insert into public.order_activity(order_id, event_type, description, user_id)
    values (new.id, 'archived', 'Se archivó el pedido: pasó a Historial y quedó registrado en Finanzas.', auth.uid());
  elsif new.due_date is distinct from old.due_date then
    insert into public.order_activity(order_id, event_type, description, user_id)
    values (new.id, 'due_date_changed', 'Se modificó la fecha de entrega.', auth.uid());
  else
    insert into public.order_activity(order_id, event_type, description, user_id)
    values (new.id, 'updated', 'Se actualizaron los datos del pedido.', auth.uid());
  end if;
  return new;
end $$;

create or replace function public.archive_finished_orders(p_days integer default 7)
returns integer
language plpgsql security definer set search_path = public as $$
declare archived integer;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;
  update public.orders
     set archived_at = now()
   where archived_at is null
     and status = 'Finalizado'
     and coalesce(quoted_price, 0) > 0
     and coalesce(completed_at, updated_at) < now() - make_interval(days => p_days);
  get diagnostics archived = row_count;
  return archived;
end $$;

revoke all on function public.archive_finished_orders(integer) from public, anon;
grant execute on function public.archive_finished_orders(integer) to authenticated;

notify pgrst, 'reload schema';
