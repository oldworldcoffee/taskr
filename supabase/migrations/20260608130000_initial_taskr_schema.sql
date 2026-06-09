create extension if not exists pgcrypto;

create table if not exists public.companies (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  name text not null,
  admin_email text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_tier text not null default 'trial',
  trial_start_date date,
  trial_end_date date,
  discount_coupon text,
  discount_expires_at date,
  is_active boolean not null default true
);

create table if not exists public.users (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  email text unique,
  full_name text,
  company_id text references public.companies(id) on delete set null,
  assigned_locations text[] not null default '{}'::text[],
  role text not null default 'employee' check (role in ('employee', 'supervisor', 'manager', 'admin', 'super_admin')),
  phone_number text,
  avatar_url text
);

create table if not exists public.locations (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  name text not null,
  address text,
  is_active boolean not null default true
);

create table if not exists public.brand_settings (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  business_name text,
  logo_url text,
  company_id text,
  primary_color text,
  secondary_color text
);

create table if not exists public.checklists (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  name text not null,
  company_id text,
  location_id text,
  shift_type text,
  recommended_start_time text,
  expected_duration_minutes double precision default 30,
  is_active boolean not null default true
);

create table if not exists public.task_groups (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  checklist_id text,
  company_id text,
  name text not null,
  sort_order double precision default 0
);

create table if not exists public.tasks (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  checklist_id text,
  company_id text,
  group_id text,
  title text not null,
  description text,
  task_type text not null default 'checkbox',
  sort_order double precision default 0,
  is_required boolean not null default false,
  estimated_minutes double precision default 1,
  parent_task_id text,
  scheduled_days text[] not null default '{}'::text[],
  due_time text,
  kb_article_ids text[] not null default '{}'::text[]
);

create table if not exists public.checklist_instances (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  checklist_id text,
  company_id text,
  location_id text,
  date date,
  shift_type text,
  status text not null default 'in_progress',
  started_at text,
  started_by text,
  started_by_name text,
  completed_at text,
  completed_by text,
  flagged_reason text,
  active_users text[] not null default '{}'::text[],
  completion_notes text
);

create table if not exists public.task_completions (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  instance_id text,
  task_id text,
  company_id text,
  completed_by_email text,
  completed_by_name text,
  completed_at text,
  value text,
  notes text,
  is_flag boolean not null default false
);

create table if not exists public.cash_deposit_receipts (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  instance_id text,
  task_id text,
  company_id text,
  location_id text,
  date date,
  initials text,
  expected_amount double precision,
  actual_amount double precision,
  deposit_amount double precision,
  over_short double precision,
  bills jsonb not null default '{}'::jsonb,
  coins jsonb not null default '{}'::jsonb,
  rolled_coins jsonb not null default '{}'::jsonb,
  notes text,
  completed_by_email text,
  completed_by_name text
);

create table if not exists public.kb_folders (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  name text not null,
  company_id text,
  location_id text,
  sort_order double precision default 0,
  authorized_emails text[] not null default '{}'::text[]
);

create table if not exists public.kb_articles (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  title text not null,
  content text,
  folder_id text,
  company_id text,
  location_id text,
  media_urls text[] not null default '{}'::text[],
  file_urls text[] not null default '{}'::text[],
  author_name text,
  author_email text,
  is_draft boolean not null default false
);

create table if not exists public.forum_boards (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  name text not null,
  company_id text,
  description text,
  location_id text,
  authorized_emails text[] not null default '{}'::text[],
  created_by_email text
);

create table if not exists public.forum_posts (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  title text not null,
  content text,
  company_id text,
  location_id text,
  board_id text,
  author_name text,
  author_email text,
  is_announcement boolean not null default false,
  is_pinned boolean not null default false,
  kb_article_ids text[] not null default '{}'::text[]
);

create table if not exists public.forum_comments (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  post_id text,
  company_id text,
  content text,
  author_name text,
  author_email text
);

create table if not exists public.chat_channels (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  name text not null,
  company_id text,
  description text,
  location_id text,
  authorized_emails text[] not null default '{}'::text[],
  created_by_email text
);

create table if not exists public.chat_messages (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  location_id text,
  dm_channel_id text,
  dm_participants text[] not null default '{}'::text[],
  content text,
  author_name text,
  author_email text
);

create table if not exists public.equipment (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  name text not null,
  company_id text,
  location_id text,
  category text,
  model text,
  serial_number text,
  purchase_date date,
  last_service_date date,
  next_service_date date,
  service_interval_days double precision,
  notes text,
  is_active boolean not null default true
);

create table if not exists public.service_schedules (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  equipment_id text,
  company_id text,
  location_id text,
  service_type text,
  interval_days double precision,
  last_scheduled_date date,
  next_due_date date,
  is_active boolean not null default true,
  notes text
);

create table if not exists public.service_records (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  equipment_id text,
  company_id text,
  location_id text,
  service_date date,
  service_type text,
  performed_by text,
  cost double precision,
  description text,
  next_service_date date,
  logged_by_email text,
  logged_by_name text
);

create table if not exists public.pending_invites (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  email text not null,
  name text,
  role text not null default 'employee',
  assigned_locations text[] not null default '{}'::text[],
  company_id text,
  invited_by text
);

create table if not exists public.subscriptions (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  tier text,
  status text,
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_start date,
  current_period_end date,
  cancel_at_period_end boolean not null default false
);

create table if not exists public.platform_settings (
  id text primary key default 'default',
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  pricing_tiers jsonb not null default '{"1_location":49,"5_locations":149,"unlimited":299}'::jsonb,
  trial_days integer not null default 15
);

insert into public.platform_settings (id)
values ('default')
on conflict (id) do nothing;

create index if not exists users_company_id_idx on public.users(company_id);
create index if not exists users_email_idx on public.users(lower(email));
create index if not exists pending_invites_email_idx on public.pending_invites(lower(email));

create index if not exists locations_company_id_idx on public.locations(company_id);
create index if not exists checklists_company_id_idx on public.checklists(company_id);
create index if not exists task_groups_company_id_idx on public.task_groups(company_id);
create index if not exists tasks_company_id_idx on public.tasks(company_id);
create index if not exists checklist_instances_company_id_idx on public.checklist_instances(company_id);
create index if not exists task_completions_company_id_idx on public.task_completions(company_id);
create index if not exists kb_folders_company_id_idx on public.kb_folders(company_id);
create index if not exists kb_articles_company_id_idx on public.kb_articles(company_id);
create index if not exists forum_posts_company_id_idx on public.forum_posts(company_id);
create index if not exists chat_messages_company_id_idx on public.chat_messages(company_id);

create or replace function public.set_updated_date()
returns trigger
language plpgsql
as $$
begin
  new.updated_date = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'brand_settings',
    'cash_deposit_receipts',
    'chat_channels',
    'chat_messages',
    'checklist_instances',
    'checklists',
    'companies',
    'equipment',
    'forum_boards',
    'forum_comments',
    'forum_posts',
    'kb_articles',
    'kb_folders',
    'locations',
    'pending_invites',
    'platform_settings',
    'service_records',
    'service_schedules',
    'subscriptions',
    'task_completions',
    'task_groups',
    'tasks',
    'users'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_date on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_date before update on public.%I for each row execute function public.set_updated_date()',
      table_name,
      table_name
    );
  end loop;
end $$;

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
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_company_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.users where id = auth.uid()::text limit 1
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid()::text limit 1
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

alter table public.brand_settings enable row level security;
alter table public.cash_deposit_receipts enable row level security;
alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;
alter table public.checklist_instances enable row level security;
alter table public.checklists enable row level security;
alter table public.companies enable row level security;
alter table public.equipment enable row level security;
alter table public.forum_boards enable row level security;
alter table public.forum_comments enable row level security;
alter table public.forum_posts enable row level security;
alter table public.kb_articles enable row level security;
alter table public.kb_folders enable row level security;
alter table public.locations enable row level security;
alter table public.pending_invites enable row level security;
alter table public.platform_settings enable row level security;
alter table public.service_records enable row level security;
alter table public.service_schedules enable row level security;
alter table public.subscriptions enable row level security;
alter table public.task_completions enable row level security;
alter table public.task_groups enable row level security;
alter table public.tasks enable row level security;
alter table public.users enable row level security;

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
using (id = auth.uid()::text or public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
for insert to authenticated
with check (id = auth.uid()::text);

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
  or email = (select email from public.users where id = auth.uid()::text)
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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'brand_settings',
    'cash_deposit_receipts',
    'chat_channels',
    'chat_messages',
    'checklist_instances',
    'checklists',
    'equipment',
    'forum_boards',
    'forum_comments',
    'forum_posts',
    'kb_articles',
    'kb_folders',
    'locations',
    'service_records',
    'service_schedules',
    'task_completions',
    'task_groups',
    'tasks'
  ]
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

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter default privileges in schema public
grant select, insert, update, delete on tables to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('taskr-uploads', 'taskr-uploads', true, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists taskr_uploads_read on storage.objects;
create policy taskr_uploads_read on storage.objects
for select
using (bucket_id = 'taskr-uploads');

drop policy if exists taskr_uploads_insert on storage.objects;
create policy taskr_uploads_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'taskr-uploads' and owner = auth.uid());

drop policy if exists taskr_uploads_update on storage.objects;
create policy taskr_uploads_update on storage.objects
for update to authenticated
using (bucket_id = 'taskr-uploads' and owner = auth.uid())
with check (bucket_id = 'taskr-uploads' and owner = auth.uid());

drop policy if exists taskr_uploads_delete on storage.objects;
create policy taskr_uploads_delete on storage.objects
for delete to authenticated
using (bucket_id = 'taskr-uploads' and owner = auth.uid());
