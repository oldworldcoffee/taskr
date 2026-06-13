import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

// Per-event packing list ("things to pack"). `manage` enables adding/removing
// items; the checkbox check-off works in both manage and field views.
export default function PackingSection({
  items = [],
  manage = false,
  onAdd,
  onToggle,
  onRemove,
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const ordered = [...items].sort((a, b) => (a.item_order ?? 0) - (b.item_order ?? 0));
  const packed = ordered.filter((i) => i.checked).length;

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onAdd({ item_name: name, quantity: qty });
      setName("");
      setQty(1);
    } catch (e) {
      toast.error(e.message || "Could not add item");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <h4 className="text-sm font-semibold">Packing List</h4>
          <p className="text-xs text-muted-foreground">
            Gear and supplies to load before leaving.
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {packed}/{ordered.length}
        </span>
      </div>

      <div className="space-y-1">
        {ordered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Nothing to pack yet.</p>
        ) : (
          ordered.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border px-2.5 py-2"
            >
              <Checkbox checked={!!item.checked} onCheckedChange={() => onToggle(item)} />
              <span
                className={`flex-1 min-w-0 text-sm truncate ${
                  item.checked ? "line-through text-muted-foreground" : ""
                }`}
              >
                {item.item_name}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">×{item.quantity}</span>
              {manage && (
                <button
                  onClick={() => onRemove(item)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove item"
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Item to pack..."
            className="h-8 text-sm"
          />
          <Input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-8 w-16 text-sm"
            aria-label="Quantity"
          />
          <Button size="sm" variant="secondary" onClick={add} disabled={busy}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
