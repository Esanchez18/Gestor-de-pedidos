-- Delivery details and shipping amount stored on each order.
alter table public.orders
  add column if not exists delivery_address text,
  add column if not exists delivery_locality text,
  add column if not exists shipping_cost numeric(12,2) not null default 0
    check (shipping_cost >= 0);
