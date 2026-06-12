import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import TimezoneSelect, { TIMEZONE_UNSET } from "@/components/shared/TimezoneSelect";
import {
  normalizeOptionalMoney, formatMoneyInput, preventNegativeAmountKey, hasLocationDrawerOverride,
} from "@/lib/locationFormat";
import { settingsFromData } from "@/lib/laborSettings";
import FinancialLaborSettingsForm from "@/components/locations/modules/FinancialLaborSettingsForm";
import InventoryLocationSettings from "@/components/locations/modules/InventoryLocationSettings";
import { ClipboardList, PackageCheck, Coffee, DollarSign, Trash2, Link2 } from "lucide-react";

const LOCATION_TYPES = [
  { value: "retail", label: "Retail" },
  { value: "roastery", label: "Roastery" },
  { value: "hybrid", label: "Hybrid (retail + roastery)" },
];

// The four live modules shown as per-location toggles.
const MODULE_TOGGLES = [
  { key: "is_task_checklist_enabled", label: "Task & Checklists", icon: ClipboardList,
    desc: "Daily checklists, issues, and deposit reports for this location." },
  { key: "is_inventory_enabled", label: "Inventory", icon: PackageCheck,
    desc: "Stock counts, orders, transfers, and invoices." },
  { key: "is_roastery_enabled", label: "Roastery", icon: Coffee,
    desc: "Green coffee, roast production, and release scheduling." },
  { key: "is_financial_enabled", label: "Financial", icon: DollarSign,
    desc: "Labor scheduling and Square sales forecasting." },
];

function seedDraft(location) {
  return {
    name: location.name || "",
    address: location.address || "",
    location_type: location.location_type || "retail",
    is_active: location.is_active !== false,
    timezone: location.timezone || TIMEZONE_UNSET,
    cash_drawer_amount: hasLocationDrawerOverride(location) ? formatMoneyInput(location.cash_drawer_amount) : "",
    primary_manager_user_id: location.primary_manager_user_id || "",
    secondary_manager_user_id: location.secondary_manager_user_id || "",
    notes: location.notes || "",
    is_task_checklist_enabled: location.is_task_checklist_enabled !== false,
    is_inventory_enabled: Boolean(location.is_inventory_enabled),
    is_roastery_enabled: Boolean(location.is_roastery_enabled),
    is_financial_enabled: Boolean(location.is_financial_enabled),
    inventory: {
      type: location.inventory_settings_json?.type || (location.is_commissary ? "commissary" : "location"),
      preferred_stock_weeks: location.preferred_stock_weeks ?? 1,
    },
    financial: settingsFromData(location.financial_settings_json),
  };
}

export default function LocationControlPanel({ location, open, onOpenChange, company, onSaved, onRequestDelete }) {
  const [draft, setDraft] = useState(() => seedDraft(location || {}));
  const [saving, setSaving] = useState(false);

  // Reseed whenever a different location is opened.
  useEffect(() => {
    if (location) setDraft(seedDraft(location));
  }, [location?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: users = [] } = useQuery({
    queryKey: ["all-users", company?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyUsers", {});
      return res.data?.users || [];
    },
    enabled: open,
  });

  const managerOptions = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.full_name || u.email })),
    [users]
  );

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast.error("Location name is required");
      return;
    }
    setSaving(true);
    try {
      const patch = {
        name: draft.name.trim(),
        address: draft.address.trim(),
        location_type: draft.location_type,
        is_active: draft.is_active,
        timezone: draft.timezone === TIMEZONE_UNSET ? null : draft.timezone,
        cash_drawer_amount: draft.location_type === "roastery" ? null : normalizeOptionalMoney(draft.cash_drawer_amount),
        primary_manager_user_id: draft.primary_manager_user_id || null,
        secondary_manager_user_id: draft.secondary_manager_user_id || null,
        notes: draft.notes.trim() || null,
        is_task_checklist_enabled: draft.is_task_checklist_enabled,
        is_inventory_enabled: draft.is_inventory_enabled,
        is_roastery_enabled: draft.is_roastery_enabled,
        is_financial_enabled: draft.is_financial_enabled,
        is_commissary: draft.inventory.type === "commissary",
        preferred_stock_weeks: Number(draft.inventory.preferred_stock_weeks || 1),
        inventory_settings_json: { type: draft.inventory.type },
        financial_settings_json: draft.financial,
      };
      const res = await base44.functions.invoke("updateLocationConfig", { location_id: location.id, patch });
      if (res.data?.error) {
        toast.error(res.data.error);
        return;
      }
      toast.success("Location saved");
      await onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message || "Failed to save location");
    } finally {
      setSaving(false);
    }
  };

  if (!location) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle>Location Settings</SheetTitle>
          <SheetDescription>Configure base info, operations, and enabled modules for this location.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Header / base */}
          <section className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Location Type</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={draft.location_type}
                onChange={(e) => set({ location_type: e.target.value })}
              >
                {LOCATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground mt-1">Roastery or Hybrid locations enable roastery production features.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive locations are hidden but not deleted.</p>
              </div>
              <Switch checked={draft.is_active} onCheckedChange={(v) => set({ is_active: v })} />
            </div>
          </section>

          {/* Location info */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Location Info</h3>
            <div>
              <Label>Address</Label>
              <Input value={draft.address} onChange={(e) => set({ address: e.target.value })} placeholder="Full address" className="mt-1" />
            </div>
            <div>
              <Label>Timezone</Label>
              <TimezoneSelect value={draft.timezone} onChange={(tz) => set({ timezone: tz })} />
              <p className="text-xs text-muted-foreground mt-1">Used for end-of-day inventory snapshots.</p>
            </div>
          </section>

          {/* Operational */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Operational</h3>
            {draft.location_type !== "roastery" && (
              <div>
                <Label>Cash Drawer Amount ($)</Label>
                <Input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={draft.cash_drawer_amount}
                  onChange={(e) => set({ cash_drawer_amount: e.target.value })}
                  onKeyDown={preventNegativeAmountKey}
                  placeholder={formatMoneyInput(company?.cash_drawer_amount ?? 200)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave blank to use the company default.</p>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Primary Manager</Label>
                <select
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                  value={draft.primary_manager_user_id}
                  onChange={(e) => set({ primary_manager_user_id: e.target.value })}
                >
                  <option value="">None</option>
                  {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Secondary Manager</Label>
                <select
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                  value={draft.secondary_manager_user_id}
                  onChange={(e) => set({ secondary_manager_user_id: e.target.value })}
                >
                  <option value="">None</option>
                  {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label>Internal Notes</Label>
              <Textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes about this location" className="mt-1" rows={3} />
            </div>
          </section>

          {/* Feature toggles */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Modules</h3>
            <div className="space-y-2">
              {MODULE_TOGGLES.map(({ key, label, icon: Icon, desc }) => {
                const enabled = draft[key];
                return (
                  <div key={key} className="rounded-lg border border-border">
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-start gap-2.5">
                        <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                      </div>
                      <Switch checked={enabled} onCheckedChange={(v) => set({ [key]: v })} />
                    </div>

                    {key === "is_inventory_enabled" && enabled && (
                      <div className="border-t border-border p-3">
                        <InventoryLocationSettings
                          value={draft.inventory}
                          onChange={(patch) => set({ inventory: { ...draft.inventory, ...patch } })}
                        />
                      </div>
                    )}

                    {key === "is_financial_enabled" && enabled && (
                      <div className="border-t border-border p-3">
                        <FinancialLaborSettingsForm
                          value={draft.financial}
                          onChange={(next) => set({ financial: next })}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Square integration (read-only; full sync is future) */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Link2 className="h-4 w-4" /> Square Integration</h3>
            <div className="rounded-lg border border-border p-3 text-sm">
              {location.square_location_id ? (
                <p>Linked to Square location <span className="font-mono text-xs">{location.square_location_id}</span></p>
              ) : (
                <p className="text-muted-foreground">Not linked to a Square location. Connect Square in Financial → Settings to enable matching.</p>
              )}
            </div>
          </section>

          {/* Danger zone */}
          {onRequestDelete && (
            <section className="pt-2 border-t border-border">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => { onOpenChange(false); onRequestDelete(location); }}
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete location
              </Button>
            </section>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !draft.name.trim()}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
