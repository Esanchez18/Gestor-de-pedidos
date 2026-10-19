-- Pirañalab catalog: public fields are separated from private STL references/files.
create table if not exists public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (length(trim(slug)) between 1 and 140),
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 180),
  slug text not null unique check (length(trim(slug)) between 1 and 200),
  description text not null default '',
  image_path text,
  category_id uuid not null references public.catalog_categories(id) on delete restrict,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_catalog_product_has_public_details check (not is_published or (image_path is not null and length(trim(description)) > 0))
);

-- This table is intentionally inaccessible to anon; do not add STL columns to catalog_products.
create table if not exists public.catalog_product_private_files (
  product_id uuid primary key references public.catalog_products(id) on delete cascade,
  stl_url text check (stl_url is null or stl_url ~* '^https?://'),
  stl_path text,
  updated_at timestamptz not null default now(),
  constraint catalog_product_one_stl_source check (stl_url is null or stl_path is null)
);

create index if not exists catalog_products_category_idx on public.catalog_products(category_id);
create index if not exists catalog_products_public_idx on public.catalog_products(is_published, updated_at desc);
create index if not exists catalog_products_title_idx on public.catalog_products using gin(to_tsvector('simple', title));

drop trigger if exists catalog_categories_touch_updated on public.catalog_categories;
create trigger catalog_categories_touch_updated
  before update on public.catalog_categories
  for each row execute function public.touch_updated_at();
drop trigger if exists catalog_products_touch_updated on public.catalog_products;
create trigger catalog_products_touch_updated
  before update on public.catalog_products
  for each row execute function public.touch_updated_at();

alter table public.catalog_categories enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_product_private_files enable row level security;

drop policy if exists "Catalog admins manage categories" on public.catalog_categories;
create policy "Catalog admins manage categories"
  on public.catalog_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Public read categories used by published products" on public.catalog_categories;
create policy "Public read categories used by published products"
  on public.catalog_categories for select to anon, authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.catalog_products p
      where p.category_id = catalog_categories.id and p.is_published = true
    )
  );

drop policy if exists "Catalog admins manage products" on public.catalog_products;
create policy "Catalog admins manage products"
  on public.catalog_products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Public read published products" on public.catalog_products;
create policy "Public read published products"
  on public.catalog_products for select to anon, authenticated
  using (is_published = true or public.is_admin());

drop policy if exists "Catalog admins manage private product files" on public.catalog_product_private_files;
create policy "Catalog admins manage private product files"
  on public.catalog_product_private_files for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.catalog_categories, public.catalog_products from public, anon, authenticated;
grant select on public.catalog_categories, public.catalog_products to anon, authenticated;
grant insert, update, delete on public.catalog_categories, public.catalog_products to authenticated;
revoke all on public.catalog_product_private_files from public, anon, authenticated;
grant select, insert, update, delete on public.catalog_product_private_files to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-images', 'catalog-images', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-stl', 'catalog-stl', false, 52428800,
  array['application/octet-stream', 'application/sla', 'model/stl', 'application/vnd.ms-pki.stl']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read catalog images" on storage.objects;
drop policy if exists "Public read published catalog images" on storage.objects;
create policy "Public read published catalog images"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'catalog-images'
    and (
      public.is_admin()
      or exists (
        select 1 from public.catalog_products p
        where p.image_path = storage.objects.name and p.is_published = true
      )
    )
  );
drop policy if exists "Catalog admins upload images" on storage.objects;
create policy "Catalog admins upload images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog-images' and public.is_admin());
drop policy if exists "Catalog admins update images" on storage.objects;
create policy "Catalog admins update images"
  on storage.objects for update to authenticated
  using (bucket_id = 'catalog-images' and public.is_admin())
  with check (bucket_id = 'catalog-images' and public.is_admin());
drop policy if exists "Catalog admins delete images" on storage.objects;
create policy "Catalog admins delete images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'catalog-images' and public.is_admin());

drop policy if exists "Catalog admins manage private STL files" on storage.objects;
create policy "Catalog admins manage private STL files"
  on storage.objects for all to authenticated
  using (bucket_id = 'catalog-stl' and public.is_admin())
  with check (bucket_id = 'catalog-stl' and public.is_admin());
