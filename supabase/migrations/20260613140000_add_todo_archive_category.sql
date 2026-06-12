-- To-Dos: archive support (manual + auto for finished one-offs) and free-text
-- categories for grouping in the admin and employee views.
-- archived_at IS NULL = active. Archived todos are hidden from the active
-- admin list, excluded from occurrence generation, and their pending
-- occurrences are hidden from employees. is_active keeps its existing
-- "paused" meaning; archive is the stronger, list-removing state.

alter table public.todos add column if not exists archived_at timestamptz;
alter table public.todos add column if not exists category text;

create index if not exists todos_company_archived_idx
  on public.todos (company_id, archived_at);
