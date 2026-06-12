import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Controlled per-location inventory settings (inventory role + target stock weeks).
// `value` is { type, preferred_stock_weeks }; `onChange` receives a patch.
// Toggling type to "commissary" sets is_commissary on the location; the backend
// location-update path syncs the matching commissary vendor.
export default function InventoryLocationSettings({ value, onChange }) {
  const type = value?.type || "location";
  const preferredStockWeeks = value?.preferred_stock_weeks ?? 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label>Inventory Type</Label>
        <Select value={type} onValueChange={(next) => onChange({ type: next })}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="location">Location</SelectItem>
            <SelectItem value="commissary">Commissary</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          Commissary locations fulfill internal orders for other locations.
        </p>
      </div>
      <div>
        <Label>Target Stock Weeks</Label>
        <Input
          className="mt-1"
          type="number"
          min="0"
          step="0.5"
          value={preferredStockWeeks}
          onChange={(e) => onChange({ preferred_stock_weeks: e.target.value })}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Weeks of stock to target when computing suggested order quantities.
        </p>
      </div>
    </div>
  );
}
