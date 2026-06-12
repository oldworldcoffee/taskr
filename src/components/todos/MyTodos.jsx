import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ListChecks,
  ChevronDown,
  ChevronRight,
  History,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { useMyTodos } from "@/hooks/useMyTodos";
import CompletedHistory from "./CompletedHistory";

/**
 * Group occurrences by their todo's category. Group order follows the admin's
 * drag-and-drop order (min sort_order of the todos in each group, falling back
 * to alphabetical); uncategorized items come last under a null category
 * ("Other" — the heading is only rendered when a real category also exists).
 */
function groupByCategory(items, todoById) {
  const map = new Map();
  for (const it of items) {
    const todo = todoById[it.todo_id];
    const cat = (todo?.category || "").trim() || null;
    const key = cat ? cat.toLowerCase() : "";
    if (!map.has(key)) map.set(key, { category: cat, minSort: Infinity, items: [] });
    const g = map.get(key);
    g.items.push(it);
    const so = todo?.sort_order;
    if (so != null && so < g.minSort) g.minSort = so;
  }
  return [...map.values()].sort((a, b) => {
    if (!a.category) return 1;
    if (!b.category) return -1;
    if (a.minSort !== b.minSort) return a.minSort - b.minSort;
    return a.category.localeCompare(b.category);
  });
}

export default function MyTodos({ title = "My Tasks", compact = false, showHistory = false }) {
  const { overdue, todayItems, upcoming, doneToday, today, todoById, toggle } = useMyTodos();

  // Rows mid-completion: show the checked state for a beat so the user sees
  // the check fill in before the row moves to the Completed section.
  const [completingIds, setCompletingIds] = useState(() => new Set());
  const handleToggle = (occ) => {
    if (occ.status === "completed") {
      toggle(occ);
      return;
    }
    if (completingIds.has(occ.id)) return;
    setCompletingIds((prev) => new Set(prev).add(occ.id));
    setTimeout(async () => {
      try {
        await toggle(occ);
      } finally {
        setCompletingIds((prev) => {
          const next = new Set(prev);
          next.delete(occ.id);
          return next;
        });
      }
    }, 400);
  };

  const [showDone, setShowDone] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const totalOpen = overdue.length + todayItems.length;
  const hasAny = totalOpen + upcoming.length + doneToday.length > 0;

  // Today's progress. Date-less ("anytime") tasks count as part of Today.
  const doneTodayInToday = useMemo(
    () => doneToday.filter((o) => !o.due_date || o.due_date === today),
    [doneToday, today]
  );
  const todayTotal = todayItems.length + doneTodayInToday.length;

  // Celebrate clearing the last due task (skip the compact dashboard card).
  const prevDue = useRef(totalOpen);
  useEffect(() => {
    if (prevDue.current > 0 && totalOpen === 0 && doneToday.length > 0 && !compact) {
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.7 } });
    }
    prevDue.current = totalOpen;
  }, [totalOpen, doneToday.length, compact]);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {!compact && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" /> {title}
          </h2>
          <div className="flex items-center gap-3">
            {totalOpen > 0 && (
              <span className="text-sm text-muted-foreground">{totalOpen} due</span>
            )}
            {showHistory && (
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <History className="h-4 w-4" /> History
              </button>
            )}
          </div>
        </div>
      )}

      {(compact ? totalOpen === 0 : !hasAny) && (
        <div className={`text-center text-muted-foreground ${compact ? "py-4" : "py-10"}`}>
          <CheckCircle2 className={`mx-auto mb-2 opacity-40 ${compact ? "h-6 w-6" : "h-8 w-8"}`} />
          <p className="text-sm">
            {compact ? "Nothing due right now." : "You're all caught up. No to-dos right now."}
          </p>
        </div>
      )}

      {overdue.length > 0 && (
        <Section
          label="Overdue"
          count={`${overdue.length}`}
          icon={AlertTriangle}
          tone="text-destructive"
          items={overdue}
          todoById={todoById}
          onToggle={handleToggle}
          completingIds={completingIds}
          today={today}
        />
      )}
      {todayItems.length > 0 && (
        <Section
          label="Today"
          count={`${doneTodayInToday.length} of ${todayTotal}`}
          icon={Clock}
          tone="text-primary"
          items={todayItems}
          todoById={todoById}
          onToggle={handleToggle}
          completingIds={completingIds}
          doneItems={doneTodayInToday}
          today={today}
        />
      )}
      {!compact && upcoming.length > 0 && (
        <Section
          label="Upcoming"
          count={`${upcoming.length}`}
          icon={Circle}
          tone="text-muted-foreground"
          items={upcoming}
          todoById={todoById}
          onToggle={handleToggle}
          completingIds={completingIds}
          today={today}
        />
      )}

      {!compact && doneToday.length > 0 && (
        <div>
          <button
            onClick={() => setShowDone((v) => !v)}
            className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 mb-2 text-green-600 hover:text-green-700 transition-colors"
          >
            {showDone ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed ({doneToday.length})
          </button>
          {showDone && (
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {doneToday.map((occ) => (
                  <Row
                    key={occ.id}
                    occ={occ}
                    todo={todoById[occ.todo_id]}
                    done
                    onToggle={handleToggle}
                    today={today}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {showHistory && (
        <CompletedHistory open={historyOpen} onOpenChange={setHistoryOpen} />
      )}
    </div>
  );
}

function Section({
  label,
  count,
  icon: Icon,
  tone,
  items,
  todoById,
  onToggle,
  completingIds,
  doneItems = null,
  today,
}) {
  const groups = groupByCategory(items, todoById);
  const hasCategories = groups.some((g) => g.category);

  // Per-category "x of y" only makes sense for Today, where doneItems is passed.
  const doneByCategory = useMemo(() => {
    if (!doneItems) return null;
    const m = new Map();
    for (const o of doneItems) {
      const cat = ((todoById[o.todo_id]?.category || "").trim() || "").toLowerCase();
      m.set(cat, (m.get(cat) || 0) + 1);
    }
    return m;
  }, [doneItems, todoById]);

  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 mb-1.5 ${tone}`}>
        <Icon className="h-3.5 w-3.5" /> {label}
        {count && <span className="font-normal normal-case text-muted-foreground">· {count}</span>}
      </h3>
      <div className="space-y-2.5">
        {groups.map((g) => {
          const catKey = (g.category || "").toLowerCase();
          const doneCount = doneByCategory?.get(catKey) || 0;
          return (
            <div key={g.category || "__other"}>
              {hasCategories && (
                <p className="text-[11px] font-medium text-muted-foreground mb-1 pl-0.5">
                  {g.category || "Other"}
                  {doneByCategory && (
                    <span> · {doneCount} of {g.items.length + doneCount}</span>
                  )}
                </p>
              )}
              <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {g.items.map((occ) => (
                    <Row
                      key={occ.id}
                      occ={occ}
                      todo={todoById[occ.todo_id]}
                      done={completingIds.has(occ.id)}
                      onToggle={onToggle}
                      today={today}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ occ, todo, done, onToggle, today }) {
  // Right-side hint: the date only when it isn't today's (Today rows just show
  // the time, anytime rows show nothing).
  const showDate = occ.due_date && occ.due_date !== today;
  const hint = [showDate ? occ.due_date : null, occ.due_time].filter(Boolean).join(" · ");
  return (
    <motion.button
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
      transition={{ duration: 0.25 }}
      onClick={() => onToggle(occ)}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors text-left"
    >
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${done ? "line-through text-muted-foreground" : ""}`}>
          {todo?.name || "To-Do"}
        </span>
        {todo?.description && (
          <span className="block truncate text-xs text-muted-foreground">
            {todo.description}
          </span>
        )}
      </span>
      {hint && (
        <span className="text-[11px] text-muted-foreground shrink-0">{hint}</span>
      )}
    </motion.button>
  );
}
