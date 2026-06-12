-- RBAC redesign — Phase 1: roles, role templates, and the per-(user,location,module)
-- access matrix that replaces the flat users.assigned_locations + global
-- users.feature_permissions model.
--
-- Design (see plan joyful-soaring-wren.md):
--   * users.role text stays AUTHORITATIVE for routing/authorization. Custom roles
--     are "pinned" to one of the 5 base roles via roles.base_role; a user on a
--     custom role has users.role = base_role AND users.role_id = <custom role id>.
--     So current_role()/is_company_manager()/RoleRouter/canSeeItem keep working.
--   * Module access for a (user, location, module) resolves as:
--       manager/admin/super_admin  -> always true (auto-grant, unchanged)
--       else explicit matrix row    -> use row.enabled (override wins, incl. false)
--       else role template default  -> role_module_defaults.enabled
--     all still AND-gated by the company + location enable flags in the FRONTEND
--     (featureAccess.js); RLS only enforces the user-grant layer, as it does today.
--
-- This migration is additive and backward-compatible: it does NOT drop
-- feature_permissions/assigned_locations, and the access helpers keep a legacy
-- fallback for any user who has no matrix rows yet (a later cleanup migration
-- removes the fallback once the frontend is fully cut over).

-- ---------------------------------------------------------------------------
-- 1. roles — system (company_id null) + per-company custom roles
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text references public.companies(id) on delete cascade,  -- null = system role
  key text not null,            -- role string ('employee'..'super_admin') or custom slug
  label text not null,
  is_system boolean not null default false,
  base_role text not null default 'employee'
    check (base_role in ('employee','supervisor','manager','admin','super_admin')),
  sort_order double precision not null default 0
);

create unique index if not exists roles_company_key_uidx
  on public.roles (coalesce(company_id, '__system__'), key);
create index if not exists roles_company_id_idx on public.roles (company_id);

drop trigger if exists set_roles_updated_date on public.roles;
create trigger set_roles_updated_date
before update on public.roles
for each row execute function public.set_updated_date();

insert into public.roles (id, company_id, key, label, is_system, base_role, sort_order)
values
  ('role_sys_employee',    null, 'employee',    'Employee',      true, 'employee',    10),
  ('role_sys_supervisor',  null, 'supervisor',  'Supervisor',    true, 'supervisor',  20),
  ('role_sys_manager',     null, 'manager',     'Manager',       true, 'manager',     30),
  ('role_sys_admin',       null, 'admin',       'Company Admin', true, 'admin',       40),
  ('role_sys_super_admin', null, 'super_admin', 'Super Admin',   true, 'super_admin', 50)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. role_module_defaults — the default module template per role
-- ---------------------------------------------------------------------------
create table if not exists public.role_module_defaults (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  role_id text not null references public.roles(id) on delete cascade,
  module text not null check (module in ('task_checklist','inventory','roastery','financial')),
  enabled boolean not null default false,
  roastery_perms jsonb not null default '{}'::jsonb,  -- only meaningful when module='roastery'
  unique (role_id, module)
);

create index if not exists role_module_defaults_role_idx on public.role_module_defaults (role_id);

drop trigger if exists set_role_module_defaults_updated_date on public.role_module_defaults;
create trigger set_role_module_defaults_updated_date
before update on public.role_module_defaults
for each row execute function public.set_updated_date();

-- Seed templates: managers/admins/super_admins get every module (they also
-- auto-grant via is_company_manager, so this is mostly cosmetic for them);
-- employees/supervisors get nothing by default EXCEPT task_checklist, which is
-- always on for everyone today.
insert into public.role_module_defaults (role_id, module, enabled, roastery_perms)
select r.id,
       m.module,
       case
         when r.key in ('manager','admin','super_admin') then true
         when m.module = 'task_checklist' then true
         else false
       end,
       case
         when m.module = 'roastery' and r.key in ('manager','admin','super_admin')
           then '{"view_production":true,"manage_production":true,"inventory_adjustments":true,"reporting":true}'::jsonb
         else '{}'::jsonb
       end
from public.roles r
cross join (values ('task_checklist'), ('inventory'), ('roastery'), ('financial')) as m(module)
where r.is_system
on conflict (role_id, module) do nothing;

-- ---------------------------------------------------------------------------
-- 3. New pointer columns (additive; existing columns untouched)
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists role_id text references public.roles(id) on delete set null;
alter table public.pending_invites add column if not exists role_id text references public.roles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. user_location_module_access — the core matrix
-- ---------------------------------------------------------------------------
create table if not exists public.user_location_module_access (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,  -- denormalized for RLS
  user_id text not null references public.users(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  module text not null check (module in ('task_checklist','inventory','roastery','financial')),
  enabled boolean not null default false,
  roastery_perms jsonb not null default '{}'::jsonb,
  unique (user_id, location_id, module)
);

create index if not exists ulma_user_idx on public.user_location_module_access (user_id);
create index if not exists ulma_lookup_idx on public.user_location_module_access (user_id, location_id, module);
create index if not exists ulma_company_idx on public.user_location_module_access (company_id);

drop trigger if exists set_ulma_updated_date on public.user_location_module_access;
create trigger set_ulma_updated_date
before update on public.user_location_module_access
for each row execute function public.set_updated_date();

-- ---------------------------------------------------------------------------
-- 5. RLS on the new tables. Writes go through service-role edge functions
--    (saveRole / saveUserModuleAccess), so authenticated gets read-only access.
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.role_module_defaults enable row level security;
alter table public.user_location_module_access enable row level security;

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
for select to authenticated
using (company_id is null or public.is_company_member(company_id));

drop policy if exists role_module_defaults_select on public.role_module_defaults;
create policy role_module_defaults_select on public.role_module_defaults
for select to authenticated
using (exists (
  select 1 from public.roles r
  where r.id = role_id and (r.company_id is null or public.is_company_member(r.company_id))
));

drop policy if exists ulma_select on public.user_location_module_access;
create policy ulma_select on public.user_location_module_access
for select to authenticated
using (user_id = auth.uid()::text or public.is_company_manager(company_id));

grant select on public.roles to authenticated;
grant select on public.role_module_defaults to authenticated;
grant select on public.user_location_module_access to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backfill the matrix so NOBODY loses access on deploy.
--    For every employee/supervisor, materialize enabled=true rows for the
--    modules they have today, at each location they can access today
--    (assigned_locations empty => all company locations). Managers/admins get
--    no rows (they auto-grant). task_checklist needs no rows (role default true).
-- ---------------------------------------------------------------------------
insert into public.user_location_module_access (company_id, user_id, location_id, module, enabled, roastery_perms)
select u.company_id, u.id, l.id, m.module, true,
       case when m.module = 'roastery'
            then coalesce(u.feature_permissions -> 'roastery', '{}'::jsonb) - 'enabled'
            else '{}'::jsonb end
from public.users u
join public.locations l
  on l.company_id = u.company_id
 and (u.assigned_locations = '{}' or l.id = any (u.assigned_locations))
cross join (values ('inventory'), ('roastery'), ('financial')) as m(module)
where u.role in ('employee','supervisor')
  and u.company_id is not null
  and (
        (m.module = 'inventory'
           and ((u.feature_permissions -> 'inventory') = 'true'::jsonb
             or (u.feature_permissions #> '{inventory,enabled}') = 'true'::jsonb))
     or (m.module = 'financial'
           and ((u.feature_permissions -> 'financial') = 'true'::jsonb
             or (u.feature_permissions #> '{financial,enabled}') = 'true'::jsonb))
     or (m.module = 'roastery'
           and (u.feature_permissions #> '{roastery,enabled}') = 'true'::jsonb)
      )
on conflict (user_id, location_id, module) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Access-resolution helper functions
-- ---------------------------------------------------------------------------

-- The current user's role-template default for a module (system role matched by
-- users.role, or a custom role via users.role_id).
create or replace function public.current_role_module_default(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select d.enabled
    from public.users u
    join public.roles r
      on r.id = coalesce(
           u.role_id,
           (select s.id from public.roles s where s.company_id is null and s.key = u.role limit 1)
         )
    join public.role_module_defaults d on d.role_id = r.id and d.module = p_module
    where u.id = auth.uid()::text
    limit 1
  ), false)
$$;

-- Legacy fallback: the pre-RBAC global grant from users.feature_permissions.
-- Only consulted for users who have NO matrix rows yet (not migrated/managed by
-- the new system), so it never widens a per-location override. Drop in cleanup.
create or replace function public.current_legacy_module_grant(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case p_module
      when 'inventory' then (u.feature_permissions -> 'inventory') = 'true'::jsonb
                         or (u.feature_permissions #> '{inventory,enabled}') = 'true'::jsonb
      when 'financial' then (u.feature_permissions -> 'financial') = 'true'::jsonb
                         or (u.feature_permissions #> '{financial,enabled}') = 'true'::jsonb
      when 'roastery'  then (u.feature_permissions #> '{roastery,enabled}') = 'true'::jsonb
      else false
    end
    from public.users u
    where u.id = auth.uid()::text
    limit 1
  ), false)
$$;

-- Generic per-row resolver. NULL row_location_id => a company-level row: grant if
-- the module is enabled at ANY location for this user (override true anywhere or
-- role default true).
create or replace function public.has_module_access(row_company_id text, row_location_id text, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_company_manager(row_company_id)
    or (
      public.is_company_member(row_company_id)
      and (
        case
          when row_location_id is null then
            public.current_role_module_default(p_module)
            or exists (
              select 1 from public.user_location_module_access a
              where a.user_id = auth.uid()::text and a.module = p_module and a.enabled
            )
          else
            coalesce(
              (select a.enabled
                 from public.user_location_module_access a
                where a.user_id = auth.uid()::text
                  and a.location_id = row_location_id
                  and a.module = p_module
                limit 1),
              public.current_role_module_default(p_module)
            )
        end
        -- transition fallback: only for users with no matrix rows at all
        or (
          not exists (select 1 from public.user_location_module_access a
                       where a.user_id = auth.uid()::text)
          and public.current_legacy_module_grant(p_module)
        )
      )
    )
$$;

-- Location-aware overloads (used by the operational-table policies in Phase 2).
create or replace function public.has_inventory_access(row_company_id text, row_location_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.has_module_access(row_company_id, row_location_id, 'inventory') $$;

create or replace function public.has_financial_access(row_company_id text, row_location_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.has_module_access(row_company_id, row_location_id, 'financial') $$;

-- Redefine the legacy 1-arg wrappers to delegate to the matrix (NULL location =
-- "anywhere"), so any table without a location_id keeps a single source of truth.
create or replace function public.has_inventory_access(row_company_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.has_module_access(row_company_id, null, 'inventory') $$;

create or replace function public.has_financial_access(row_company_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.has_module_access(row_company_id, null, 'financial') $$;

notify pgrst, 'reload schema';
