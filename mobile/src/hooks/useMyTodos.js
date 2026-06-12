import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, addDays } from 'date-fns';
import { base44 } from '../lib/base44';
import { useAuth } from '../lib/AuthContext';
import {
  resolveAssignees,
  ensureOccurrences,
  completeOccurrence,
  reopenOccurrence,
} from '../lib/todos';

const WINDOW_BACK = 14;
const WINDOW_FWD = 14;

// Port of the web app's src/hooks/useMyTodos.js. Same lazy-occurrence
// generation and grouping; data loading uses plain state instead of
// react-query, and a module lock still guards concurrent generation.
const generationLock = new Set();

export function useMyTodos() {
  const { user } = useAuth();
  const today = format(new Date(), 'yyyy-MM-dd');

  const [todos, setTodos] = useState([]);
  const [groups, setGroups] = useState([]);
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(true);

  const me = useMemo(
    () => ({ email: user?.email, full_name: user?.full_name, role: user?.role }),
    [user]
  );

  const loadTodos = useCallback(async () => {
    if (!user?.company_id) return;
    const data = await base44.entities.Todo.filter({ company_id: user.company_id });
    setTodos(data);
  }, [user?.company_id]);

  const loadGroups = useCallback(async () => {
    if (!user?.company_id) return;
    const data = await base44.entities.TodoGroup.filter({ company_id: user.company_id });
    setGroups(data);
  }, [user?.company_id]);

  const refetchOccurrences = useCallback(async () => {
    if (!user?.email) return;
    const data = await base44.entities.TodoOccurrence.filter({
      assignee_email: user.email,
    });
    setOccurrences(data);
  }, [user?.email]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadTodos(), loadGroups(), refetchOccurrences()]);
    } finally {
      setLoading(false);
    }
  }, [loadTodos, loadGroups, refetchOccurrences]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Lazily materialize missing occurrences in a window around today.
  useEffect(() => {
    if (!user?.company_id || !user?.email || todos.length === 0) return;
    if (generationLock.has(user.email)) return;
    generationLock.add(user.email);
    let cancelled = false;
    (async () => {
      try {
        const windowStart = addDays(new Date(), -WINDOW_BACK);
        const windowEnd = addDays(new Date(), WINDOW_FWD);
        let created = false;
        for (const todo of todos) {
          if (!todo.is_active) continue;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, groups, user?.email]);

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
      if (o.status === 'completed') {
        if ((o.completed_at || '').slice(0, 10) === today) doneToday.push(o);
        continue;
      }
      if (o.due_date < today) overdue.push(o);
      else if (o.due_date === today) todayItems.push(o);
      else upcoming.push(o);
    }
    const byDate = (a, b) => (a.due_date < b.due_date ? -1 : 1);
    return {
      overdue: overdue.sort(byDate),
      todayItems: todayItems.sort(byDate),
      upcoming: upcoming.sort(byDate),
      doneToday,
    };
  }, [occurrences, today]);

  const toggle = useCallback(
    async (occ) => {
      const todo = todoById[occ.todo_id];
      // Optimistic flip.
      setOccurrences((prev) =>
        prev.map((o) =>
          o.id === occ.id
            ? {
                ...o,
                status: o.status === 'completed' ? 'pending' : 'completed',
                completed_at:
                  o.status === 'completed' ? null : new Date().toISOString(),
              }
            : o
        )
      );
      try {
        if (occ.status === 'completed') {
          await reopenOccurrence(occ);
        } else {
          await completeOccurrence({ occurrence: occ, todo, user });
        }
      } catch (e) {
        // Revert on failure.
        refetchOccurrences();
        throw e;
      }
    },
    [todoById, user, refetchOccurrences]
  );

  return { ...grouped, todoById, toggle, loading, reload };
}
