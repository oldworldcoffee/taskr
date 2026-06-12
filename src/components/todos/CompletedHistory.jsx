import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, parseISO } from "date-fns";
import { CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const HISTORY_DAYS = 30;

/**
 * Day-grouped log of the user's completed to-dos (last 30 days), shown in a
 * side sheet from the My Tasks page. Read-only — reopening is only offered
 * for today's completions in the main list.
 */
export default function CompletedHistory({ open, onOpenChange }) {
  const { user } = useAuth();
  const since = format(addDays(new Date(), -HISTORY_DAYS), "yyyy-MM-dd");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["my-todo-history", user?.email],
    queryFn: () =>
      base44.entities.TodoOccurrence.filter(
        { assignee_email: user.email, status: "completed", completed_at: { $gte: since } },
        "-completed_at",
        200
      ),
    enabled: open && !!user?.email,
  });

  const { data: todos = [] } = useQuery({
    queryKey: ["todos", user?.company_id],
    queryFn: () => base44.entities.Todo.filter({ company_id: user.company_id }),
    enabled: open && !!user?.company_id,
  });

  const todoById = useMemo(() => {
    const m = {};
    todos.forEach((t) => (m[t.id] = t));
    return m;
  }, [todos]);

  const days = useMemo(() => {
    const map = new Map();
    for (const o of rows) {
      const day = (o.completed_at || "").slice(0, 10);
      if (!day) continue;
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(o);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(addDays(new Date(), -1), "yyyy-MM-dd");
  const dayLabel = (day) =>
    day === today
      ? "Today"
      : day === yesterday
        ? "Yesterday"
        : format(parseISO(day), "EEEE, MMM d");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Completed history</SheetTitle>
          <SheetDescription>What you've checked off, day by day.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {isLoading && (
            <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
          )}
          {!isLoading && days.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nothing completed in the last {HISTORY_DAYS} days.</p>
            </div>
          )}

          {days.map(([day, items]) => (
            <div key={day}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {dayLabel(day)}
              </h3>
              <div className="space-y-2">
                {items.map((occ) => {
                  const todo = todoById[occ.todo_id];
                  return (
                    <div
                      key={occ.id}
                      className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card"
                    >
                      <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{todo?.name || "To-Do"}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {todo?.category && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {todo.category}
                            </Badge>
                          )}
                          {occ.completed_at && (
                            <span className="text-[11px] text-muted-foreground">
                              {format(parseISO(occ.completed_at), "h:mm a")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {!isLoading && days.length > 0 && (
            <p className="text-[11px] text-muted-foreground text-center pb-4">
              Showing the last {HISTORY_DAYS} days
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
