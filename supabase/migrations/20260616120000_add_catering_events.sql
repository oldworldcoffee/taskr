-- Catering Event Management: events with crew assignments and three phases of
-- checklists (pre-event prep, on-arrival, wrap-up) plus a per-event packing list.
-- Company-scoped, mirroring the to-dos feature; CRUD runs from the client via
-- the entity layer with RLS enforcing company membership.

create table if not exists public.catering_events (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  event_name text not null,
  event_date timestamptz,
  event_location text,
  event_notes text,
  status text not null default 'upcoming',  -- upcoming | completed | cancelled
  created_by_email text,
  created_by_name text
);

create table if not exists public.catering_crew (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  event_id text,
  user_email text,
  user_name text,
  crew_role text,
  assigned_at timestamptz not null default now()
);

create table if not exists public.catering_checklist_items (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  event_id text,
  phase_type text not null default 'pre_event',  -- pre_event | on_arrival | wrap_up
  task_name text not null,
  task_order integer not null default 0,
  due_before_event text,  -- free-form deadline note for pre-event prep tasks
  completed boolean not null default false,
  completed_at text,
  completed_by_email text,
  completed_by_name text,
  constraint catering_checklist_phase_check
    check (phase_type in ('pre_event', 'on_arrival', 'wrap_up'))
);

create table if not exists public.catering_packing_list (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text,
  event_id text,
  item_name text not null,
  quantity integer not null default 1,
  item_order integer not null default 0,
  checked boolean not null default false,
  checked_at text,
  checked_by_email text
);

create index if not exists catering_events_company_id_idx on public.catering_events(company_id);
create index if not exists catering_events_company_date_idx on public.catering_events(company_id, event_date);
create index if not exists catering_crew_company_id_idx on public.catering_crew(company_id);
create index if not exists catering_crew_event_id_idx on public.catering_crew(event_id);
create index if not exists catering_crew_user_email_idx on public.catering_crew(user_email);
create index if not exists catering_checklist_company_id_idx on public.catering_checklist_items(company_id);
create index if not exists catering_checklist_event_phase_idx on public.catering_checklist_items(event_id, phase_type, task_order);
create index if not exists catering_packing_company_id_idx on public.catering_packing_list(company_id);
create index if not exists catering_packing_event_id_idx on public.catering_packing_list(event_id);

alter table public.catering_events enable row level security;
alter table public.catering_crew enable row level security;
alter table public.catering_checklist_items enable row level security;
alter table public.catering_packing_list enable row level security;

-- Company-scoped RLS, matching the pattern used by the to-dos migration.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'catering_events',
    'catering_crew',
    'catering_checklist_items',
    'catering_packing_list'
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

grant select, insert, update, delete on public.catering_events to authenticated;
grant select, insert, update, delete on public.catering_crew to authenticated;
grant select, insert, update, delete on public.catering_checklist_items to authenticated;
grant select, insert, update, delete on public.catering_packing_list to authenticated;
