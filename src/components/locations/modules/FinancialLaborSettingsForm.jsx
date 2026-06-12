import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Clock, Settings2 } from "lucide-react";
import { DAYS } from "@/lib/laborSettings";

// Controlled labor-settings form body (no card chrome, no location selector, no
// submit button). Used by the standalone Labor Settings page and the Master
// Location Control Panel. `value` is the settings object (see settingsFromData);
// `onChange` receives the next settings object.
export default function FinancialLaborSettingsForm({ value, onChange }) {
  const settings = value;
  const set = (patch) => onChange({ ...settings, ...patch });

  const updateDay = (dayIndex, field, fieldValue) => {
    onChange({
      ...settings,
      operating_hours: {
        ...settings.operating_hours,
        [dayIndex]: { ...settings.operating_hours[dayIndex], [field]: fieldValue },
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2"><Settings2 className="w-4 h-4" /> Labor Cost Mode</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={settings.labor_cost_mode === "simplified" ? "default" : "outline"}
            size="sm"
            onClick={() => set({ labor_cost_mode: "simplified" })}
          >
            Simplified
          </Button>
          <Button
            type="button"
            variant={settings.labor_cost_mode === "detailed" ? "default" : "outline"}
            size="sm"
            onClick={() => set({ labor_cost_mode: "detailed" })}
          >
            Detailed
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {settings.labor_cost_mode === "simplified"
            ? "Use a single all-in average hourly rate (e.g. from raw payroll)."
            : "Break down floor staff rate with tax, benefits, and manager overhead."}
        </p>
      </div>

      {/* Simplified Mode */}
      {settings.labor_cost_mode === "simplified" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hourly_rate">Average Hourly Labor Cost ($)</Label>
            <Input
              id="hourly_rate"
              type="number"
              step="0.01"
              placeholder="18.00"
              value={settings.hourly_rate}
              onChange={(e) => set({ hourly_rate: parseFloat(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">All-in rate including taxes, benefits, and overhead.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="target_labor_pct">Target Labor % of Sales</Label>
            <Input
              id="target_labor_pct"
              type="number"
              step="0.1"
              placeholder="25"
              value={settings.target_labor_pct}
              onChange={(e) => set({ target_labor_pct: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>
      )}

      {/* Detailed Mode */}
      {settings.labor_cost_mode === "detailed" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="target_labor_pct">Target Labor % of Sales</Label>
              <Input
                id="target_labor_pct"
                type="number"
                step="0.1"
                placeholder="25"
                value={settings.target_labor_pct}
                onChange={(e) => set({ target_labor_pct: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="floor_hourly_rate">Floor Staff Base Hourly Rate ($)</Label>
              <Input
                id="floor_hourly_rate"
                type="number"
                step="0.01"
                placeholder="16.00"
                value={settings.floor_hourly_rate}
                onChange={(e) => set({ floor_hourly_rate: parseFloat(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">Average base wage for scheduled floor staff.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax_percentage">Payroll Tax % </Label>
              <Input
                id="tax_percentage"
                type="number"
                step="0.1"
                placeholder="8.5"
                value={settings.tax_percentage}
                onChange={(e) => set({ tax_percentage: parseFloat(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">Applied to floor staff and managers (e.g. FICA, FUTA, SUTA).</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="benefits_percentage">Benefits % </Label>
              <Input
                id="benefits_percentage"
                type="number"
                step="0.1"
                placeholder="5.0"
                value={settings.benefits_percentage}
                onChange={(e) => set({ benefits_percentage: parseFloat(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">Health, insurance, etc. Applied to floor staff and managers.</p>
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
            <h4 className="font-medium text-sm">Manager Overhead</h4>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="manager_compensation">Manager Annual Salary ($)</Label>
                <Input
                  id="manager_compensation"
                  type="number"
                  step="1"
                  placeholder="50000"
                  value={settings.manager_compensation}
                  onChange={(e) => set({ manager_compensation: parseFloat(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">Total annual compensation for this manager (salary across all locations).</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manager_hours_allocated">Hours/Week Allocated to This Location</Label>
                <Input
                  id="manager_hours_allocated"
                  type="number"
                  step="0.5"
                  placeholder="10"
                  value={settings.manager_hours_allocated}
                  onChange={(e) => set({ manager_hours_allocated: parseFloat(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">Out of a 40-hr week, how many hours does this manager spend here?</p>
              </div>
            </div>
            {settings.manager_compensation > 0 && settings.manager_hours_allocated > 0 && (() => {
              const weeklyTotal = settings.manager_compensation / 52;
              const weeklyAllocated = weeklyTotal * (settings.manager_hours_allocated / 40);
              const loadedWeekly = weeklyAllocated * (1 + (settings.tax_percentage || 0) / 100) * (1 + (settings.benefits_percentage || 0) / 100);
              const loadedHourly = loadedWeekly / settings.manager_hours_allocated;
              return (
                <div className="text-xs text-muted-foreground bg-background rounded p-3 border space-y-1">
                  <div>Weekly salary (full): <strong>${weeklyTotal.toFixed(2)}/wk</strong></div>
                  <div>Allocated to this location ({settings.manager_hours_allocated} of 40 hrs): <strong>${weeklyAllocated.toFixed(2)}/wk</strong></div>
                  <div>With taxes & benefits: <strong>${loadedWeekly.toFixed(2)}/wk</strong> → <strong>${loadedHourly.toFixed(2)}/hr</strong></div>
                </div>
              );
            })()}
          </div>

          <div className="space-y-2">
            <Label htmlFor="labor_cost_offset">Labor Cost Offset ($/hr)</Label>
            <Input
              id="labor_cost_offset"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={settings.labor_cost_offset}
              onChange={(e) => set({ labor_cost_offset: parseFloat(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">Flat per-hour adjustment if the calculated rate needs fine-tuning (can be negative).</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          <h3 className="font-semibold">Operating Hours</h3>
        </div>
        <div className="space-y-3">
          {DAYS.map((day, index) => (
            <div key={day} className="flex items-center gap-4 p-3 rounded-lg border">
              <div className="w-24 font-medium">{day}</div>
              <Switch
                checked={settings.operating_hours[index]?.enabled}
                onCheckedChange={(checked) => updateDay(index, "enabled", checked)}
              />
              {settings.operating_hours[index]?.enabled && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={settings.operating_hours[index]?.open}
                    onChange={(e) => updateDay(index, "open", e.target.value)}
                    className="w-32"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={settings.operating_hours[index]?.close}
                    onChange={(e) => updateDay(index, "close", e.target.value)}
                    className="w-32"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
