-- Native (Expo/APNs) push tokens for the mobile app. One row per device, keyed
-- by its unique Expo push token. Distinct from push_subscriptions, which holds
-- Web Push (VAPID) browser subscriptions. The push-fanout edge function reads
-- this table with the service role (bypassing RLS) to deliver notifications.

create table if not exists public.device_push_tokens (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  user_email text,
  token text unique,
  platform text,            -- 'ios' | 'android'
  device_name text
);

create index if not exists device_push_tokens_company_id_idx on public.device_push_tokens(company_id);
create index if not exists device_push_tokens_user_email_idx on public.device_push_tokens(user_email);

alter table public.device_push_tokens enable row level security;

-- Company-scoped RLS, matching push_subscriptions. The app upserts its own
-- token directly under the authenticated user; the edge function reads via
-- service role.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['device_push_tokens']
  loop
    execute format('drop policy if exists %I_select on public.%I', table_name, table_name);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_company_member(company_id))',
      table_name,
      table_name
    );

    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.is_company_member(company_id))',
      table_name,
      table_name
    );

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))',
      table_name,
      table_name
    );

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.is_company_member(company_id))',
      table_name,
      table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on public.device_push_tokens to authenticated;
