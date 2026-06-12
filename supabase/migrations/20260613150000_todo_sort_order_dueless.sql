-- To-Dos: drag-and-drop ordering and due-date-less one-offs.
-- sort_order is a single global sequence across a company's todos; category
-- group order is derived from each group's first todo, so dragging groups,
-- dragging within a group, and dragging across groups all just renumber it.

alter table public.todos add column if not exists sort_order integer;

update public.todos t
set sort_order = r.rn
from (
  select id, row_number() over (partition by company_id order by created_date) as rn
  from public.todos
) r
where t.id = r.id and t.sort_order is null;

-- One-off todos may now have no due date, producing occurrences with a null
-- due_date. Rebuild the idempotency index with NULLS NOT DISTINCT so the
-- app's upsert (ON CONFLICT DO NOTHING) still prevents duplicates for them.
drop index if exists public.todo_occurrences_unique_idx;
create unique index todo_occurrences_unique_idx
  on public.todo_occurrences (todo_id, assignee_email, due_date)
  nulls not distinct;
