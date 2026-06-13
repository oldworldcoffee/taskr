// Shared constants and helpers for the Catering Event Management feature.

export const EVENT_STATUSES = ["upcoming", "completed", "cancelled"];

// The three checklist phases, in execution order. `key` matches the
// catering_checklist_items.phase_type column.
export const CHECKLIST_PHASES = [
  {
    key: "pre_event",
    label: "Pre-Event Prep",
    description: "Prep tasks to finish before the crew leaves.",
  },
  {
    key: "on_arrival",
    label: "On-Arrival Tasks",
    description: "Run these in order once the crew reaches the venue.",
  },
  {
    key: "wrap_up",
    label: "Wrap-Up & Teardown",
    description: "Post-event cleanup and inventory return.",
  },
];

export const PHASE_LABELS = Object.fromEntries(
  CHECKLIST_PHASES.map((p) => [p.key, p.label])
);

// Completion progress across all checklist items + packing for an event.
export function computeProgress(checklistItems = [], packingItems = []) {
  const total = checklistItems.length + packingItems.length;
  if (total === 0) return { done: 0, total: 0, percent: 0 };
  const done =
    checklistItems.filter((t) => t.completed).length +
    packingItems.filter((p) => p.checked).length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

// Derive a display status: an upcoming event whose date has passed is "due".
export function eventTimeLabel(event) {
  if (!event?.event_date) return "No date set";
  const date = new Date(event.event_date);
  if (Number.isNaN(date.getTime())) return "No date set";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
