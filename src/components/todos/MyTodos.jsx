import { CheckCircle2, Circle, Clock, AlertTriangle, ListChecks } from "lucide-react";
import { useMyTodos } from "@/hooks/useMyTodos";

export default function MyTodos({ title = "My Tasks", compact = false }) {
  const { overdue, todayItems, upcoming, doneToday, todoById, toggle } = useMyTodos();

  const totalOpen = overdue.length + todayItems.length;
  const hasAny = totalOpen + upcoming.length + doneToday.length > 0;

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" /> {title}
          </h2>
          {totalOpen > 0 && (
            <span className="text-sm text-muted-foreground">{totalOpen} due</span>
          )}
        </div>
      )}

      {!hasAny && (
        <div className="text-center py-10 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">You're all caught up. No to-dos right now.</p>
        </div>
      )}

      {overdue.length > 0 && (
        <Section
          label="Overdue"
          icon={AlertTriangle}
          tone="text-destructive"
          items={overdue}
          todoById={todoById}
          onToggle={toggle}
        />
      )}
      {todayItems.length > 0 && (
        <Section
          label="Today"
          icon={Clock}
          tone="text-primary"
          items={todayItems}
          todoById={todoById}
          onToggle={toggle}
        />
      )}
      {!compact && upcoming.length > 0 && (
        <Section
          label="Upcoming"
          icon={Circle}
          tone="text-muted-foreground"
          items={upcoming}
          todoById={todoById}
          onToggle={toggle}
        />
      )}
      {!compact && doneToday.length > 0 && (
        <Section
          label="Completed today"
          icon={CheckCircle2}
          tone="text-green-600"
          items={doneToday}
          todoById={todoById}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

function Section({ label, icon: Icon, tone, items, todoById, onToggle }) {
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 mb-2 ${tone}`}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </h3>
      <div className="space-y-2">
        {items.map((occ) => {
          const todo = todoById[occ.todo_id];
          const done = occ.status === "completed";
          return (
            <button
              key={occ.id}
              onClick={() => onToggle(occ)}
              className="w-full flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors text-left"
            >
              {done ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`font-medium text-sm ${done ? "line-through text-muted-foreground" : ""}`}>
                  {todo?.name || "To-Do"}
                </p>
                {todo?.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {todo.description}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Due {occ.due_date}
                  {occ.due_time ? ` · ${occ.due_time}` : ""}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
