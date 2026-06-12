-- To-Dos feature: personal/role/group-assignable recurring or one-off todos
-- with deadlines and completion notifications. Distinct from checklist `tasks`.

create table if not exists public.todos (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  name text not null,
  description text,
  created_by_email text,
  created_by_name text,
  assignee_emails text[] not null default '{}'::text[],
  assignee_roles text[] not null default '{}'::text[],
  group_ids text[] not null default '{}'::text[],
  recurrence text not null default 'one_off',  -- one_off | weekly | monthly
  recurrence_days text[] not null default '{}'::text[],  -- weekday names for weekly
  recurrence_day_of_month integer,  -- 1-31 for monthly
  due_time text,
  due_date date,  -- one_off only
  notify_emails text[] not null default '{}'::text[],
  is_active boolean not null default true
);

create table if not exists public.todo_groups (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  name text not null,
  member_emails text[] not null default '{}'::text[],
  created_by_email text
);

create table if not exists public.todo_occurrences (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  todo_id text,
  assignee_email text,
  assignee_name text,
  due_date date,
  due_time text,
  status text not null default 'pending',  -- pending | completed
  completed_at text,
  completed_by_email text,
  notes text
);

create table if not exists public.notifications (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  recipient_email text,
  type text,
  title text,
  body text,
  link text,
  source_id text,
  read_at text,
  delivered_channels text[] not null default '{}'::text[]
);

create index if not exists todos_company_id_idx on public.todos(company_id);
create index if not exists todo_groups_company_id_idx on public.todo_groups(company_id);
create index if not exists todo_occurrences_company_id_idx on public.todo_occurrences(company_id);
create index if not exists todo_occurrences_todo_id_idx on public.todo_occurrences(todo_id);
create index if not exists todo_occurrences_assignee_due_idx on public.todo_occurrences(assignee_email, due_date);
create index if not exists notifications_company_id_idx on public.notifications(company_id);
create index if not exists notifications_recipient_read_idx on public.notifications(recipient_email, read_at);

alter table public.todos enable row level security;
alter table public.todo_groups enable row level security;
alter table public.todo_occurrences enable row level security;
alter table public.notifications enable row level security;

-- Company-scoped RLS, matching the pattern in the initial schema migration.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'todos',
    'todo_groups',
    'todo_occurrences',
    'notifications'
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

grant select, insert, update, delete on public.todos to authenticated;
grant select, insert, update, delete on public.todo_groups to authenticated;
grant select, insert, update, delete on public.todo_occurrences to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;
