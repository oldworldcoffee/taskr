alter table public.inventory_vendors
add column if not exists commissary_location_id text references public.locations(id) on delete set null;

create unique index if not exists inventory_vendors_commissary_location_id_idx
  on public.inventory_vendors(company_id, commissary_location_id)
  where commissary_location_id is not null;

update public.inventory_vendors vendor
set
  commissary_location_id = location.id,
  is_commissary = true,
  is_active = true,
  address = coalesce(vendor.address, location.address),
  notes = coalesce(nullif(vendor.notes, ''), 'Linked to commissary location')
from public.inventory_location_settings setting
join public.locations location on location.id = setting.location_id
where setting.type = 'commissary'
  and vendor.company_id = setting.company_id
  and vendor.commissary_location_id is null
  and vendor.is_commissary = true
  and lower(vendor.name) = lower(location.name);

insert into public.inventory_vendors (
  company_id,
  commissary_location_id,
  name,
  order_type,
  address,
  notes,
  is_active,
  is_commissary,
  authorized_location_ids
)
select
  setting.company_id,
  location.id,
  location.name,
  'email',
  location.address,
  'Auto-created from commissary location',
  true,
  true,
  array(
    select buyer_location.id
    from public.locations buyer_location
    where buyer_location.company_id = setting.company_id
      and buyer_location.is_active = true
  )
from public.inventory_location_settings setting
join public.locations location on location.id = setting.location_id
where setting.type = 'commissary'
  and not exists (
    select 1
    from public.inventory_vendors vendor
    where vendor.company_id = setting.company_id
      and (
        vendor.commissary_location_id = location.id
        or (vendor.is_commissary = true and lower(vendor.name) = lower(location.name))
      )
  );
