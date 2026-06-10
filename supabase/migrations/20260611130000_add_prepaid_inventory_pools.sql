-- Prepaid inventory pools: bulk purchases held by the vendor and drawn down
-- by $0 drop-off invoices at a locked unit cost.

create table if not exists public.inventory_prepaid_pools (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete cascade,
  vendor_id text references public.inventory_vendors(id) on delete set null,
  vendor_name text not null default '',
  source_invoice_id text references public.inventory_invoices(id) on delete set null,
  label text not null default '',
  total_quantity numeric not null check (total_quantity > 0),
  unit_of_measure text not null default 'EA',
  total_cost numeric not null default 0,
  unit_cost numeric not null default 0,
  remaining_quantity numeric not null default 0,
  status text not null default 'active' check (status in ('active', 'depleted', 'closed')),
  purchased_date date,
  notes text not null default ''
);

drop trigger if exists set_inventory_prepaid_pools_updated_date on public.inventory_prepaid_pools;
create trigger set_inventory_prepaid_pools_updated_date
before update on public.inventory_prepaid_pools
for each row execute function public.set_updated_date();

create index if not exists inventory_prepaid_pools_company_id_idx
  on public.inventory_prepaid_pools(company_id);
create index if not exists inventory_prepaid_pools_item_status_idx
  on public.inventory_prepaid_pools(company_id, item_id, status);

create table if not exists public.inventory_pool_drawdowns (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  pool_id text not null references public.inventory_prepaid_pools(id) on delete cascade,
  item_id text not null,
  location_id text not null references public.locations(id) on delete cascade,
  invoice_id text references public.inventory_invoices(id) on delete set null,
  quantity numeric not null,
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  drawn_date date not null default (now()::date),
  draw_type text not null default 'invoice' check (draw_type in ('invoice', 'manual_adjustment')),
  notes text not null default ''
);

drop trigger if exists set_inventory_pool_drawdowns_updated_date on public.inventory_pool_drawdowns;
create trigger set_inventory_pool_drawdowns_updated_date
before update on public.inventory_pool_drawdowns
for each row execute function public.set_updated_date();

create index if not exists inventory_pool_drawdowns_company_id_idx
  on public.inventory_pool_drawdowns(company_id);
create index if not exists inventory_pool_drawdowns_pool_id_idx
  on public.inventory_pool_drawdowns(pool_id);
create index if not exists inventory_pool_drawdowns_location_date_idx
  on public.inventory_pool_drawdowns(company_id, location_id, drawn_date);
create index if not exists inventory_pool_drawdowns_invoice_id_idx
  on public.inventory_pool_drawdowns(invoice_id);

-- remaining_quantity is derived from drawdowns; the app never writes it directly.
create or replace function public.recalculate_pool_remaining()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_pool_id text;
begin
  if tg_table_name = 'inventory_pool_drawdowns' then
    target_pool_id := coalesce(new.pool_id, old.pool_id);
  else
    target_pool_id := new.id;
  end if;

  update public.inventory_prepaid_pools p
  set remaining_quantity = p.total_quantity - coalesce((
        select sum(d.quantity) from public.inventory_pool_drawdowns d
        where d.pool_id = target_pool_id
      ), 0),
      status = case
        when p.status = 'closed' then 'closed'
        when p.total_quantity - coalesce((
          select sum(d.quantity) from public.inventory_pool_drawdowns d
          where d.pool_id = target_pool_id
        ), 0) <= 0 then 'depleted'
        else 'active'
      end
  where p.id = target_pool_id;

  return null;
end;
$$;

drop trigger if exists inventory_pool_drawdowns_recalculate on public.inventory_pool_drawdowns;
create trigger inventory_pool_drawdowns_recalculate
after insert or update or delete on public.inventory_pool_drawdowns
for each row execute function public.recalculate_pool_remaining();

drop trigger if exists inventory_prepaid_pools_recalculate on public.inventory_prepaid_pools;
create trigger inventory_prepaid_pools_recalculate
after update of total_quantity on public.inventory_prepaid_pools
for each row execute function public.recalculate_pool_remaining();

-- Initialize remaining_quantity on insert so new pools start full.
create or replace function public.initialize_pool_remaining()
returns trigger
language plpgsql
as $$
begin
  new.remaining_quantity := new.total_quantity;
  return new;
end;
$$;

drop trigger if exists inventory_prepaid_pools_initialize on public.inventory_prepaid_pools;
create trigger inventory_prepaid_pools_initialize
before insert on public.inventory_prepaid_pools
for each row execute function public.initialize_pool_remaining();

alter table public.inventory_prepaid_pools enable row level security;

drop policy if exists inventory_prepaid_pools_select on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_select on public.inventory_prepaid_pools
for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists inventory_prepaid_pools_insert on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_insert on public.inventory_prepaid_pools
for insert to authenticated
with check (public.is_company_manager(company_id));

drop policy if exists inventory_prepaid_pools_update on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_update on public.inventory_prepaid_pools
for update to authenticated
using (public.is_company_manager(company_id))
with check (public.is_company_manager(company_id));

drop policy if exists inventory_prepaid_pools_delete on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_delete on public.inventory_prepaid_pools
for delete to authenticated
using (public.is_company_manager(company_id));

grant select, insert, update, delete on public.inventory_prepaid_pools to authenticated;

alter table public.inventory_pool_drawdowns enable row level security;

drop policy if exists inventory_pool_drawdowns_select on public.inventory_pool_drawdowns;
create policy inventory_pool_drawdowns_select on public.inventory_pool_drawdowns
for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists inventory_pool_drawdowns_insert on public.inventory_pool_drawdowns;
create policy inventory_pool_drawdowns_insert on public.inventory_pool_drawdowns
for insert to authenticated
with check (public.is_company_manager(company_id));

drop policy if exists inventory_pool_drawdowns_update on public.inventory_pool_drawdowns;
create policy inventory_pool_drawdowns_update on public.inventory_pool_drawdowns
for update to authenticated
using (public.is_company_manager(company_id))
with check (public.is_company_manager(company_id));

drop policy if exists inventory_pool_drawdowns_delete on public.inventory_pool_drawdowns;
create policy inventory_pool_drawdowns_delete on public.inventory_pool_drawdowns
for delete to authenticated
using (public.is_company_manager(company_id));

grant select, insert, update, delete on public.inventory_pool_drawdowns to authenticated;

notify pgrst, 'reload schema';
