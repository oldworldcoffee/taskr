-- Fix duplicate To-Do occurrences: a (todo, assignee, due date) must be unique.
-- Lazy generation could previously insert duplicates when it ran before the
-- existing-occurrences snapshot loaded. Dedupe, then enforce uniqueness so the
-- app's upsert (ON CONFLICT DO NOTHING) keeps it idempotent.

-- 1. Remove duplicates, keeping a completed row if one exists, else the oldest.
delete from public.todo_occurrences t
using (
  select id,
    row_number() over (
      partition by todo_id, assignee_email, due_date
      order by (status = 'completed') desc, created_date asc
    ) as rn
  from public.todo_occurrences
) d
where t.id = d.id and d.rn > 1;

-- 2. Enforce uniqueness going forward.
create unique index if not exists todo_occurrences_unique_idx
  on public.todo_occurrences (todo_id, assignee_email, due_date);
