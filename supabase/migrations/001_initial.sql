create extension if not exists pgcrypto;
create sequence if not exists public.order_number_seq start 1;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'admin' check (role='admin'),
  created_at timestamptz not null default now()
);
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 1 and 180),
  type text not null default 'Particular' check(type in ('Particular','Empresa','Comercio','Evento')),
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('PIR-'||lpad(nextval('public.order_number_seq')::text,6,'0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  product_name text not null check(length(trim(product_name)) between 1 and 240),
  description text,
  quantity integer not null default 1 check(quantity>0),
  reference_image_path text,
  stl_url text check(stl_url is null or stl_url ~* '^https?://'),
  quoted_price numeric(12,2) check(quoted_price is null or quoted_price>=0),
  due_date date,
  status text not null default 'Pendiente' check(status in ('Pendiente','En proceso','Finalizado','Cancelado')),
  materials text,
  colors text,
  production_notes text,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.order_activity (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  description text not null,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_due_date_idx on public.orders(due_date);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists activity_order_created_idx on public.order_activity(order_id,created_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin')
$$;
create or replace function public.audit_order() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.order_activity(order_id,event_type,description,user_id) values(new.id,'created','Se creó el pedido '||new.order_number||'.',auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_activity(order_id,event_type,description,user_id) values(new.id,case new.status when 'Finalizado' then 'completed' when 'Cancelado' then 'cancelled' when old.status='Cancelado' then 'reactivated' else 'status_changed' end,'Estado actualizado de '||old.status||' a '||new.status||'.',auth.uid());
  elsif new.due_date is distinct from old.due_date then
    insert into public.order_activity(order_id,event_type,description,user_id) values(new.id,'due_date_changed','Se modificó la fecha de entrega.',auth.uid());
  else
    insert into public.order_activity(order_id,event_type,description,user_id) values(new.id,'updated','Se actualizaron los datos del pedido.',auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists customers_touch_updated on public.customers;
create trigger customers_touch_updated before update on public.customers for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch_updated on public.orders;
create trigger orders_touch_updated before update on public.orders for each row execute function public.touch_updated_at();
drop trigger if exists orders_audit on public.orders;
create trigger orders_audit after insert or update on public.orders for each row execute function public.audit_order();

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_activity enable row level security;
drop policy if exists "Admin reads own profile" on public.profiles;
create policy "Admin reads own profile" on public.profiles for select to authenticated using(id=auth.uid() and role='admin');
drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "Admins manage orders" on public.orders;
create policy "Admins manage orders" on public.orders for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "Admins read activity" on public.order_activity;
create policy "Admins read activity" on public.order_activity for select to authenticated using(public.is_admin());
drop policy if exists "Admins add activity" on public.order_activity;
create policy "Admins add activity" on public.order_activity for insert to authenticated with check(public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('reference-images','reference-images',false,1048576,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=1048576,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "Admins read reference images" on storage.objects;
create policy "Admins read reference images" on storage.objects for select to authenticated using(bucket_id='reference-images' and public.is_admin());
drop policy if exists "Admins upload reference images" on storage.objects;
create policy "Admins upload reference images" on storage.objects for insert to authenticated with check(bucket_id='reference-images' and public.is_admin());
drop policy if exists "Admins delete reference images" on storage.objects;
create policy "Admins delete reference images" on storage.objects for delete to authenticated using(bucket_id='reference-images' and public.is_admin());

-- Create an Auth user in Supabase, then grant access. Repeat for each trusted team member.
-- insert into public.profiles(id,display_name,role) values('AUTH_USER_UUID','Nombre','admin');
