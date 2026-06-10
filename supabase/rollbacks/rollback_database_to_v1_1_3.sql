-- Roll back database objects added during the roastery merge attempt.
-- Target app state: v1.1.3 rollback branch.
--
-- Run this in the Supabase SQL editor while connected as the project owner.
-- It does not delete Taskr companies or users. Roastery tables are copied into
-- rollback_backup before being dropped.

begin;

create schema if not exists rollback_backup;

do $$
declare
  table_name text;
  backup_name text;
begin
  foreach table_name in array array[
    'roastery_blend_component_rotations',
    'roastery_category_rotations',
    'roastery_category_slots',
    'roastery_green_coffees',
    'roastery_inventory_adjustments',
    'roastery_inventory_lots',
    'roastery_invoices',
    'roastery_pricing_records',
    'roastery_warehouse_locations'
  ]
  loop
    backup_name := table_name || '_backup_20260610';

    if to_regclass(format('public.%I', table_name)) is not null then
      execute format(
        'create table if not exists rollback_backup.%I as table public.%I',
        backup_name,
        table_name
      );
    end if;
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'roastery_blend_component_rotations',
    'roastery_category_rotations',
    'roastery_category_slots',
    'roastery_green_coffees',
    'roastery_inventory_adjustments',
    'roastery_inventory_lots',
    'roastery_invoices',
    'roastery_pricing_records',
    'roastery_warehouse_locations'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop trigger if exists set_%I_updated_date on public.%I', table_name, table_name);
      execute format('drop policy if exists %I_select on public.%I', table_name, table_name);
      execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
      execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
      execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    end if;
  end loop;
end $$;

drop table if exists public.roastery_blend_component_rotations cascade;
drop table if exists public.roastery_pricing_records cascade;
drop table if exists public.roastery_category_rotations cascade;
drop table if exists public.roastery_inventory_adjustments cascade;
drop table if exists public.roastery_inventory_lots cascade;
drop table if exists public.roastery_invoices cascade;
drop table if exists public.roastery_warehouse_locations cascade;
drop table if exists public.roastery_category_slots cascade;
drop table if exists public.roastery_green_coffees cascade;

alter table public.companies
  drop column if exists slug,
  drop column if exists company_id,
  drop column if exists owner_email,
  drop column if exists phone,
  drop column if exists address,
  drop column if exists city,
  drop column if exists state,
  drop column if exists country,
  drop column if exists logo_url,
  drop column if exists subscription_status,
  drop column if exists subscription_plan,
  drop column if exists bag_sizes,
  drop column if exists pricing_defaults,
  drop column if exists notes;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, auth_user_id, email, full_name, role)
  values (
    new.id::text,
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_app_meta_data ->> 'role', 'employee')
  )
  on conflict (id) do update
  set
    auth_user_id = excluded.auth_user_id,
    email = excluded.email,
    full_name = coalesce(nullif(public.users.full_name, ''), excluded.full_name);

  return new;
exception
  when unique_violation then
    update public.users
    set
      auth_user_id = new.id,
      full_name = coalesce(nullif(public.users.full_name, ''), new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
      updated_date = now()
    where lower(email) = lower(new.email)
      and (auth_user_id is null or auth_user_id = new.id);

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Relink existing Supabase auth accounts to matching public.users rows.
update public.users profile
set
  auth_user_id = auth_user.id,
  updated_date = now()
from auth.users auth_user
where profile.email is not null
  and auth_user.email is not null
  and lower(profile.email) = lower(auth_user.email)
  and (profile.auth_user_id is null or profile.auth_user_id = auth_user.id);

-- v1.1.3 code reads public.users by id = auth.uid(). When the matching profile
-- exists under a different imported id, move it back to the Supabase auth id.
with split_profiles as (
  select
    source.id as source_id,
    source.auth_user_id,
    source.email,
    source.full_name,
    source.company_id,
    source.assigned_locations,
    source.role,
    target.id as target_id
  from public.users source
  join public.users target
    on target.id = source.auth_user_id::text
   and target.id <> source.id
  where source.auth_user_id is not null
)
update public.users target
set
  email = coalesce(target.email, split_profiles.email),
  full_name = coalesce(nullif(target.full_name, ''), split_profiles.full_name),
  company_id = coalesce(target.company_id, split_profiles.company_id),
  assigned_locations = case
    when cardinality(target.assigned_locations) = 0 then split_profiles.assigned_locations
    else target.assigned_locations
  end,
  role = case
    when split_profiles.role = 'super_admin' then 'super_admin'
    when target.role = 'employee' then split_profiles.role
    else target.role
  end,
  updated_date = now()
from split_profiles
where target.id = split_profiles.target_id;

update public.users profile
set
  id = profile.auth_user_id::text,
  updated_date = now()
where profile.auth_user_id is not null
  and profile.id <> profile.auth_user_id::text
  and not exists (
    select 1
    from public.users existing
    where existing.id = profile.auth_user_id::text
  );

create or replace function public.current_company_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.users
  where id = auth.uid()::text
     or auth_user_id = auth.uid()
     or (
       (auth.jwt() ->> 'email') is not null
       and lower(email) = lower(auth.jwt() ->> 'email')
     )
  order by
    case when role = 'super_admin' then 0 else 1 end,
    case
      when id = auth.uid()::text then 0
      when auth_user_id = auth.uid() then 1
      else 2
    end
  limit 1
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.users
  where id = auth.uid()::text
     or auth_user_id = auth.uid()
     or (
       (auth.jwt() ->> 'email') is not null
       and lower(email) = lower(auth.jwt() ->> 'email')
     )
  order by
    case when role = 'super_admin' then 0 else 1 end,
    case
      when id = auth.uid()::text then 0
      when auth_user_id = auth.uid() then 1
      else 2
    end
  limit 1
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'super_admin', false)
$$;

create or replace function public.is_company_member(row_company_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or (row_company_id is not null and row_company_id = public.current_company_id())
$$;

create or replace function public.is_company_manager(row_company_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or (
      row_company_id is not null
      and row_company_id = public.current_company_id()
      and public.current_role() in ('admin', 'manager')
    )
$$;

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
for select to authenticated
using (public.is_super_admin() or id = public.current_company_id());

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies
for insert to authenticated
with check (public.is_super_admin());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
for update to authenticated
using (public.is_super_admin() or (id = public.current_company_id() and public.current_role() in ('admin', 'manager')))
with check (public.is_super_admin() or (id = public.current_company_id() and public.current_role() in ('admin', 'manager')));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
for delete to authenticated
using (public.is_super_admin());

drop policy if exists users_select on public.users;
create policy users_select on public.users
for select to authenticated
using (
  id = auth.uid()::text
  or auth_user_id = auth.uid()
  or (
    (auth.jwt() ->> 'email') is not null
    and lower(email) = lower(auth.jwt() ->> 'email')
  )
  or public.is_super_admin()
  or company_id = public.current_company_id()
);

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
for insert to authenticated
with check (
  id = auth.uid()::text
  or auth_user_id = auth.uid()
  or (
    (auth.jwt() ->> 'email') is not null
    and lower(email) = lower(auth.jwt() ->> 'email')
  )
);

drop policy if exists users_update_managed on public.users;
create policy users_update_managed on public.users
for update to authenticated
using (public.is_super_admin() or (company_id = public.current_company_id() and public.current_role() in ('admin', 'manager')))
with check (public.is_super_admin() or (company_id = public.current_company_id() and public.current_role() in ('admin', 'manager')));

drop policy if exists users_delete_managed on public.users;
create policy users_delete_managed on public.users
for delete to authenticated
using (public.is_super_admin() or (company_id = public.current_company_id() and public.current_role() in ('admin', 'manager')));

drop policy if exists platform_settings_super_admin on public.platform_settings;
create policy platform_settings_super_admin on public.platform_settings
for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists subscriptions_write on public.subscriptions;
create policy subscriptions_write on public.subscriptions
for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists pending_invites_select on public.pending_invites;
create policy pending_invites_select on public.pending_invites
for select to authenticated
using (
  public.is_super_admin()
  or email = (select email from public.users where id = auth.uid()::text or auth_user_id = auth.uid() limit 1)
  or public.is_company_manager(company_id)
);

drop policy if exists pending_invites_insert on public.pending_invites;
create policy pending_invites_insert on public.pending_invites
for insert to authenticated
with check (public.is_super_admin() or public.is_company_manager(company_id));

drop policy if exists pending_invites_update on public.pending_invites;
create policy pending_invites_update on public.pending_invites
for update to authenticated
using (public.is_super_admin() or public.is_company_manager(company_id))
with check (public.is_super_admin() or public.is_company_manager(company_id));

drop policy if exists pending_invites_delete on public.pending_invites;
create policy pending_invites_delete on public.pending_invites
for delete to authenticated
using (public.is_super_admin() or public.is_company_manager(company_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter default privileges in schema public
grant select, insert, update, delete on tables to authenticated;

commit;

select 'companies' as check_name, count(*)::text as value from public.companies
union all
select 'super_admin_users', count(*)::text from public.users where role = 'super_admin'
union all
select 'roastery_tables_remaining', count(*)::text
from information_schema.tables
where table_schema = 'public'
  and table_name like 'roastery_%'
union all
select 'roastery_backup_tables', count(*)::text
from information_schema.tables
where table_schema = 'rollback_backup'
  and table_name like 'roastery_%';
