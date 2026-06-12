import { base44 } from './base44';
import {
  eachDayOfInterval,
  format,
  getDate,
  getDaysInMonth,
  parseISO,
} from 'date-fns';

// Ported verbatim from the web app's src/lib/todos.js (only the base44 import
// path differs). Keeping this identical means recurrence/occurrence behavior
// matches the web exactly.

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const fmt = (d) => format(d, 'yyyy-MM-dd');

export function resolveAssignees(todo, allUsers = [], groups = []) {
  const emails = new Set();
  (todo.assignee_emails || []).forEach((e) => e && emails.add(e));

  const roles = new Set(todo.assignee_roles || []);
  if (roles.size > 0) {
    allUsers.forEach((u) => {
      if (u.email && roles.has(u.role)) emails.add(u.email);
    });
  }

  const groupIds = new Set(todo.group_ids || []);
  if (groupIds.size > 0) {
    groups.forEach((g) => {
      if (groupIds.has(g.id)) (g.member_emails || []).forEach((e) => e && emails.add(e));
    });
  }

  const nameFor = (email) => {
    const u = allUsers.find((x) => x.email === email);
    return u?.full_name || email;
  };

  return [...emails].map((email) => ({ email, name: nameFor(email) }));
}

export function computeDueDates(todo, windowStart, windowEnd) {
  if (windowEnd < windowStart) return [];

  if (todo.recurrence === 'one_off') {
    if (!todo.due_date) return [];
    const due = parseISO(todo.due_date);
    return due >= windowStart && due <= windowEnd ? [todo.due_date] : [];
  }

  const days = eachDayOfInterval({ start: windowStart, end: windowEnd });

  if (todo.recurrence === 'weekly') {
    const wanted = new Set(todo.recurrence_days || []);
    if (wanted.size === 0) return [];
    return days.filter((d) => wanted.has(WEEKDAYS[d.getDay()])).map(fmt);
  }

  if (todo.recurrence === 'monthly') {
    const dom = todo.recurrence_day_of_month;
    if (!dom) return [];
    return days
      .filter((d) => {
        const target = Math.min(dom, getDaysInMonth(d));
        return getDate(d) === target;
      })
      .map(fmt);
  }

  return [];
}

export async function ensureOccurrences({
  todo,
  assignees,
  windowStart,
  windowEnd,
  companyId,
  existingOccurrences = [],
}) {
  if (!todo.is_active) return [];
  const dueDates = computeDueDates(todo, windowStart, windowEnd);
  if (dueDates.length === 0 || assignees.length === 0) return [];

  const existingKeys = new Set(
    existingOccurrences
      .filter((o) => o.todo_id === todo.id)
      .map((o) => `${o.assignee_email}|${o.due_date}`)
  );

  const toCreate = [];
  for (const dueDate of dueDates) {
    for (const assignee of assignees) {
      const key = `${assignee.email}|${dueDate}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      toCreate.push({
        company_id: companyId || todo.company_id,
        todo_id: todo.id,
        assignee_email: assignee.email,
        assignee_name: assignee.name,
        due_date: dueDate,
        due_time: todo.due_time || null,
        status: 'pending',
      });
    }
  }

  if (toCreate.length === 0) return [];
  return base44.entities.TodoOccurrence.bulkCreate(toCreate);
}

export async function completeOccurrence({ occurrence, todo, user }) {
  const updated = await base44.entities.TodoOccurrence.update(occurrence.id, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    completed_by_email: user.email,
  });

  const recipients = (todo?.notify_emails || []).filter(
    (email) => email && email !== user.email
  );
  if (recipients.length > 0) {
    try {
      await base44.functions.invoke('notifyTodoCompletion', {
        todoId: todo.id,
        occurrenceId: occurrence.id,
      });
    } catch (e) {
      console.error('notifyTodoCompletion failed', e);
    }
  }

  return updated;
}

export function reopenOccurrence(occurrence) {
  return base44.entities.TodoOccurrence.update(occurrence.id, {
    status: 'pending',
    completed_at: null,
    completed_by_email: null,
  });
}
