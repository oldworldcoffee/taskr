-- Web Push subscriptions for To-Do / notification delivery (Phase 3).
-- One row per browser/device subscription, keyed by its unique endpoint.

create table if not exists public.push_subscriptions (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  user_email text,
  endpoint text unique,
  p256dh text,
  auth text,
  user_agent text
);

create index if not exists push_subscriptions_company_id_idx on public.push_subscriptions(company_id);
create index if not exists push_subscriptions_user_email_idx on public.push_subscriptions(user_email);

alter table public.push_subscriptions enable row level security;

-- Company-scoped RLS, matching the rest of the schema. Writes from the app go
-- through a service-role serverless function (which bypasses RLS); these
-- policies just keep direct client reads company-scoped.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['push_subscriptions']
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

grant select, insert, update, delete on public.push_subscriptions to authenticated;
