-- RBAC redesign — post-migration verification. Run AFTER applying
-- 20260613120000_add_rbac_roles_matrix.sql and 20260613130000_rbac_per_location_rls.sql.
-- All three checks should return ZERO rows. Any rows = a problem to fix before
-- relying on the new model.

-- ---------------------------------------------------------------------------
-- CHECK 1 (CRITICAL): hard access loss.
-- Any employee/supervisor who had a module grant in the old feature_permissions
-- model but ended up with NO enabled matrix row anywhere for that module.
-- Expect: 0 rows.
-- ---------------------------------------------------------------------------
with old_grants as (
  select u.id as user_id, u.email, u.company_id, m.module
  from public.users u
  cross join (values ('inventory'), ('financial'), ('roastery')) as m(module)
  where u.role in ('employee', 'supervisor')
    and (
      (m.module = 'inventory'
        and ((u.feature_permissions -> 'inventory') = 'true'::jsonb
          or (u.feature_permissions #> '{inventory,enabled}') = 'true'::jsonb))
   or (m.module = 'financial'
        and ((u.feature_permissions -> 'financial') = 'true'::jsonb
          or (u.feature_permissions #> '{financial,enabled}') = 'true'::jsonb))
   or (m.module = 'roastery'
        and (u.feature_permissions #> '{roastery,enabled}') = 'true'::jsonb))
)
select 'CHECK1_hard_access_loss' as check_name, og.*
from old_grants og
where not exists (
  select 1 from public.user_location_module_access a
  where a.user_id = og.user_id and a.module = og.module and a.enabled
);

-- ---------------------------------------------------------------------------
-- CHECK 2: per-location backfill completeness.
-- For each old grant, the user should have an enabled row at every location they
-- could access today (assigned_locations empty => all company locations).
-- Expect: 0 rows.
-- ---------------------------------------------------------------------------
with expected as (
  select u.id as user_id, u.email, l.id as location_id, m.module
  from public.users u
  join public.locations l
    on l.company_id = u.company_id
   and (u.assigned_locations = '{}' or l.id = any (u.assigned_locations))
  cross join (values ('inventory'), ('financial'), ('roastery')) as m(module)
  where u.role in ('employee', 'supervisor')
    and (
      (m.module = 'inventory'
        and ((u.feature_permissions -> 'inventory') = 'true'::jsonb
          or (u.feature_permissions #> '{inventory,enabled}') = 'true'::jsonb))
   or (m.module = 'financial'
        and ((u.feature_permissions -> 'financial') = 'true'::jsonb
          or (u.feature_permissions #> '{financial,enabled}') = 'true'::jsonb))
   or (m.module = 'roastery'
        and (u.feature_permissions #> '{roastery,enabled}') = 'true'::jsonb))
)
select 'CHECK2_missing_location_row' as check_name, e.*
from expected e
where not exists (
  select 1 from public.user_location_module_access a
  where a.user_id = e.user_id and a.location_id = e.location_id
    and a.module = e.module and a.enabled
);

-- ---------------------------------------------------------------------------
-- CHECK 3: every active user resolves to a valid role template.
-- A user whose role string has no matching system role row (and no custom
-- role_id) would have no defaults. Expect: 0 rows.
-- ---------------------------------------------------------------------------
select 'CHECK3_unresolved_role' as check_name, u.id, u.email, u.role, u.role_id
from public.users u
where u.company_id is not null
  and u.role_id is null
  and not exists (
    select 1 from public.roles r where r.company_id is null and r.key = u.role
  );
