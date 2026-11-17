-- 007: estado "Bloqueado" para el tablero de pedidos. Se puede ejecutar más de una vez.
do $$
declare c text;
begin
  -- Quita la restricción de estados actual (sea cual sea su nombre) y crea la nueva.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%Pendiente%'
  loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
end $$;

alter table public.orders add constraint orders_status_check
  check (status in ('Pendiente', 'En proceso', 'Bloqueado', 'Finalizado', 'Cancelado'));

notify pgrst, 'reload schema';
