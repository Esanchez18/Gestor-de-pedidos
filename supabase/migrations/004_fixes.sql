-- 004: correcciones de base de datos. Se puede ejecutar más de una vez sin romper nada.
-- Ejecutar completo en Supabase → SQL Editor (después de 001 y 003).

-- 1) Columnas de entrega (de 002). Corrige el error PGRST204
--    "Could not find the 'delivery_address' column of 'orders' in the schema cache".
alter table public.orders
  add column if not exists delivery_address text,
  add column if not exists delivery_locality text,
  add column if not exists shipping_cost numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_shipping_cost_check' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_shipping_cost_check check (shipping_cost >= 0);
  end if;
end $$;

-- 2) Historial: no registrar "Se actualizaron los datos" cuando no cambió nada real.
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
  elsif new.due_date is distinct from old.due_date then
    insert into public.order_activity(order_id, event_type, description, user_id)
    values (new.id, 'due_date_changed', 'Se modificó la fecha de entrega.', auth.uid());
  else
    insert into public.order_activity(order_id, event_type, description, user_id)
    values (new.id, 'updated', 'Se actualizaron los datos del pedido.', auth.uid());
  end if;
  return new;
end $$;

-- 3) RLS: (select is_admin()) se evalúa una vez por consulta en lugar de una vez por fila.
drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins manage orders" on public.orders;
create policy "Admins manage orders" on public.orders for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins read activity" on public.order_activity;
create policy "Admins read activity" on public.order_activity for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Admins add activity" on public.order_activity;
create policy "Admins add activity" on public.order_activity for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admin reads own profile" on public.profiles;
create policy "Admin reads own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) and role = 'admin');

drop policy if exists "Catalog admins manage categories" on public.catalog_categories;
create policy "Catalog admins manage categories" on public.catalog_categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Public read categories used by published products" on public.catalog_categories;
create policy "Public read categories used by published products"
  on public.catalog_categories for select to anon, authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.catalog_products p
      where p.category_id = catalog_categories.id and p.is_published = true
    )
  );

drop policy if exists "Catalog admins manage products" on public.catalog_products;
create policy "Catalog admins manage products" on public.catalog_products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Public read published products" on public.catalog_products;
create policy "Public read published products" on public.catalog_products for select to anon, authenticated
  using (is_published = true or (select public.is_admin()));

drop policy if exists "Catalog admins manage private product files" on public.catalog_product_private_files;
create policy "Catalog admins manage private product files"
  on public.catalog_product_private_files for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- 4) Storage
-- La política pública de imágenes busca por image_path: necesita índice.
create index if not exists catalog_products_image_path_idx on public.catalog_products(image_path);
create index if not exists order_activity_order_idx on public.order_activity(order_id);

drop policy if exists "Admins read reference images" on storage.objects;
create policy "Admins read reference images" on storage.objects for select to authenticated
  using (bucket_id = 'reference-images' and (select public.is_admin()));
drop policy if exists "Admins upload reference images" on storage.objects;
create policy "Admins upload reference images" on storage.objects for insert to authenticated
  with check (bucket_id = 'reference-images' and (select public.is_admin()));
drop policy if exists "Admins delete reference images" on storage.objects;
create policy "Admins delete reference images" on storage.objects for delete to authenticated
  using (bucket_id = 'reference-images' and (select public.is_admin()));

drop policy if exists "Public read published catalog images" on storage.objects;
create policy "Public read published catalog images" on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'catalog-images'
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.catalog_products p
        where p.image_path = storage.objects.name and p.is_published = true
      )
    )
  );
drop policy if exists "Catalog admins upload images" on storage.objects;
create policy "Catalog admins upload images" on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog-images' and (select public.is_admin()));
drop policy if exists "Catalog admins update images" on storage.objects;
create policy "Catalog admins update images" on storage.objects for update to authenticated
  using (bucket_id = 'catalog-images' and (select public.is_admin()))
  with check (bucket_id = 'catalog-images' and (select public.is_admin()));
drop policy if exists "Catalog admins delete images" on storage.objects;
create policy "Catalog admins delete images" on storage.objects for delete to authenticated
  using (bucket_id = 'catalog-images' and (select public.is_admin()));
drop policy if exists "Catalog admins manage private STL files" on storage.objects;
create policy "Catalog admins manage private STL files" on storage.objects for all to authenticated
  using (bucket_id = 'catalog-stl' and (select public.is_admin()))
  with check (bucket_id = 'catalog-stl' and (select public.is_admin()));

-- 5) Que la API (PostgREST) vea las columnas nuevas inmediatamente.
notify pgrst, 'reload schema';
