import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import {
  eachDayOfInterval,
  format,
  getDate,
  getDaysInMonth,
  parseISO,
} from "date-fns";

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const fmt = (d) => format(d, "yyyy-MM-dd");

/**
 * Resolve the set of people a todo is assigned to: the union of explicit
 * assignee emails, users whose role is in assignee_roles, and members of any
 * referenced custom groups. Returns [{ email, name }].
 */
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

/**
 * Compute the due dates (yyyy-MM-dd strings) a todo produces between
 * windowStart and windowEnd (inclusive), based on its recurrence rule.
 * windowStart/windowEnd are Date objects.
 */
export function computeDueDates(todo, windowStart, windowEnd) {
  if (windowEnd < windowStart) return [];

  if (todo.recurrence === "one_off") {
    if (!todo.due_date) return [];
    const due = parseISO(todo.due_date);
    return due >= windowStart && due <= windowEnd ? [todo.due_date] : [];
  }

  const days = eachDayOfInterval({ start: windowStart, end: windowEnd });

  if (todo.recurrence === "weekly") {
    const wanted = new Set(todo.recurrence_days || []);
    if (wanted.size === 0) return [];
    return days
      .filter((d) => wanted.has(WEEKDAYS[d.getDay()]))
      .map(fmt);
  }

  if (todo.recurrence === "monthly") {
    const dom = todo.recurrence_day_of_month;
    if (!dom) return [];
    return days
      .filter((d) => {
        // Clamp the target day to the month's length (e.g. 31 -> 30/28).
        const target = Math.min(dom, getDaysInMonth(d));
        return getDate(d) === target;
      })
      .map(fmt);
  }

  return [];
}

/**
 * Ensure todo_occurrence rows exist for each assignee on each due date in the
 * window. Lazy generation, mirroring how checklist instances are created on
 * demand (see src/pages/NewChecklist.jsx). Returns the list of occurrences that
 * were created (existing ones are left untouched).
 */
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
        status: "pending",
      });
    }
  }

  if (toCreate.length === 0) return [];

  // Upsert with ON CONFLICT DO NOTHING against the (todo_id, assignee_email,
  // due_date) unique index, so concurrent or stale-snapshot generation passes
  // can never create duplicate occurrences. Returns only the rows inserted.
  const { data, error } = await supabase
    .from("todo_occurrences")
    .upsert(toCreate, {
      onConflict: "todo_id,assignee_email,due_date",
      ignoreDuplicates: true,
    })
    .select("*");
  if (error) throw error;
  return data || [];
}

/**
 * Mark an occurrence completed and notify the todo's notify_emails recipients
 * with an in-app notification.
 */
export async function completeOccurrence({ occurrence, todo, user }) {
  const updated = await base44.entities.TodoOccurrence.update(occurrence.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
    completed_by_email: user.email,
  });

  // Dispatch notifications server-side: the function creates the in-app rows and
  // fans out to email + web push for each notify recipient. Best-effort — a
  // delivery failure must not block marking the to-do done.
  const recipients = (todo?.notify_emails || []).filter(
    (email) => email && email !== user.email
  );
  if (recipients.length > 0) {
    try {
      await base44.functions.invoke("notifyTodoCompletion", {
        todoId: todo.id,
        occurrenceId: occurrence.id,
      });
    } catch (e) {
      console.error("notifyTodoCompletion failed", e);
    }
  }

  return updated;
}

/** Reopen a completed occurrence (no notification). */
export function reopenOccurrence(occurrence) {
  return base44.entities.TodoOccurrence.update(occurrence.id, {
    status: "pending",
    completed_at: null,
    completed_by_email: null,
  });
}
