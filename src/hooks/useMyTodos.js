import { useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { format, addDays } from "date-fns";
import {
  resolveAssignees,
  ensureOccurrences,
  completeOccurrence,
  reopenOccurrence,
} from "@/lib/todos";

const WINDOW_BACK = 14;
const WINDOW_FWD = 14;

// Guards against concurrent generation when the hook is mounted more than once
// (e.g. the dashboard uses it for a count and embeds <MyTodos> which uses it
// again). Effects run sequentially during commit, so the first acquires the
// lock synchronously and later mounts skip generation until it releases.
const generationLock = new Set();

/**
 * Loads the current user's to-do occurrences, lazily materializing any that are
 * missing in a window around today (mirrors the on-demand checklist-instance
 * pattern), and returns them grouped plus a `toggle` action. Shared by the
 * MyTodos component and the employee dashboard card so counts stay consistent.
 */
export function useMyTodos() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const me = useMemo(
    () => ({ email: user?.email, full_name: user?.full_name, role: user?.role }),
    [user]
  );
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: todos = [] } = useQuery({
    queryKey: ["todos", user?.company_id],
    queryFn: () => base44.entities.Todo.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["todo-groups", user?.company_id],
    queryFn: () => base44.entities.TodoGroup.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  const { data: occurrences = [], refetch: refetchOccurrences } = useQuery({
    queryKey: ["my-todo-occurrences", user?.email],
    queryFn: () =>
      base44.entities.TodoOccurrence.filter({ assignee_email: user.email }),
    enabled: !!user?.email,
  });

  useEffect(() => {
    if (!user?.company_id || todos.length === 0) return;
    if (generationLock.has(user.email)) return;
    generationLock.add(user.email);
    let cancelled = false;
    (async () => {
      try {
        const windowStart = addDays(new Date(), -WINDOW_BACK);
        const windowEnd = addDays(new Date(), WINDOW_FWD);
        let created = false;
        for (const todo of todos) {
          if (!todo.is_active || todo.archived_at) continue;
          const assignees = resolveAssignees(todo, [me], groups);
          if (!assignees.some((a) => a.email === user.email)) continue;
          const result = await ensureOccurrences({
            todo,
            assignees: [{ email: user.email, name: user.full_name || user.email }],
            windowStart,
            windowEnd,
            companyId: user.company_id,
            existingOccurrences: occurrences,
          });
          if (result.length > 0) created = true;
        }
        if (created && !cancelled) refetchOccurrences();
      } finally {
        generationLock.delete(user.email);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [todos, groups, user?.email]);

  useEffect(() => {
    const unsub = base44.entities.TodoOccurrence.subscribe(() => refetchOccurrences());
    return () => unsub();
  }, []);

  // Refresh templates live too, so an admin archiving a todo (or an auto-
  // archive from another device) removes its pending items right away.
  useEffect(() => {
    const unsub = base44.entities.Todo.subscribe(() =>
      queryClient.invalidateQueries({ queryKey: ["todos"] })
    );
    return () => unsub();
  }, []);

  const todoById = useMemo(() => {
    const m = {};
    todos.forEach((t) => (m[t.id] = t));
    return m;
  }, [todos]);

  const grouped = useMemo(() => {
    const overdue = [];
    const todayItems = [];
    const upcoming = [];
    const doneToday = [];
    for (const o of occurrences) {
      if (o.status === "completed") {
        if ((o.completed_at || "").slice(0, 10) === today) doneToday.push(o);
        continue;
      }
      // Pending items of archived todos are hidden (completed ones above stay
      // visible, e.g. the occurrence whose completion auto-archived a one-off).
      if (todoById[o.todo_id]?.archived_at) continue;
      // Date-less ("anytime") tasks live in Today until completed — never overdue.
      if (!o.due_date || o.due_date === today) todayItems.push(o);
      else if (o.due_date < today) overdue.push(o);
      else upcoming.push(o);
    }
    // Dated items first (ascending), anytime items last.
    const byDate = (a, b) => {
      if (!a.due_date) return b.due_date ? 1 : 0;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    };
    return {
      overdue: overdue.sort(byDate),
      todayItems: todayItems.sort(byDate),
      upcoming: upcoming.sort(byDate),
      doneToday,
    };
  }, [occurrences, today, todoById]);

  const toggle = async (occ) => {
    if (occ.status === "completed") {
      await reopenOccurrence(occ, todoById[occ.todo_id]);
    } else {
      await completeOccurrence({ occurrence: occ, todo: todoById[occ.todo_id], user });
    }
    refetchOccurrences();
    // Completing/reopening a one-off can archive/un-archive its template.
    queryClient.invalidateQueries({ queryKey: ["todos"] });
  };

  const dueCount = grouped.overdue.length + grouped.todayItems.length;

  return { ...grouped, dueCount, today, todoById, toggle, refetch: refetchOccurrences };
}
