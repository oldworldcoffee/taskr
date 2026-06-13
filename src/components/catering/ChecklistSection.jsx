import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";

// One checklist phase. `manage` enables adding/removing tasks; otherwise it is a
// read + check-off view (used on mobile during the event). Items are shown in
// task_order so on-arrival / wrap-up phases keep their recommended sequence.
export default function ChecklistSection({
  phase,
  items = [],
  manage = false,
  onAdd,
  onToggle,
  onRemove,
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ordered = [...items].sort((a, b) => (a.task_order ?? 0) - (b.task_order ?? 0));
  const done = ordered.filter((i) => i.completed).length;

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await onAdd({ phase_type: phase.key, task_name: draft });
      setDraft("");
    } catch (e) {
      toast.error(e.message || "Could not add task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <h4 className="text-sm font-semibold">{phase.label}</h4>
          <p className="text-xs text-muted-foreground">{phase.description}</p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {done}/{ordered.length}
        </span>
      </div>

      <div className="space-y-1">
        {ordered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No tasks yet.</p>
        ) : (
          ordered.map((item, idx) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border px-2.5 py-2"
            >
              {phase.key !== "pre_event" && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <GripVertical className="h-3 w-3" />
                  {idx + 1}
                </span>
              )}
              <Checkbox
                checked={!!item.completed}
                onCheckedChange={() => onToggle(item)}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm truncate ${
                    item.completed ? "line-through text-muted-foreground" : ""
                  }`}
                >
                  {item.task_name}
                </p>
                {item.completed && item.completed_by_name && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    by {item.completed_by_name}
                  </p>
                )}
              </div>
              {manage && (
                <button
                  onClick={() => onRemove(item)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove task"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {manage && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={`Add a ${phase.label.toLowerCase()} task...`}
            className="h-8 text-sm"
          />
          <Button size="sm" variant="secondary" onClick={add} disabled={busy}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
