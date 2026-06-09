import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/layout/PageHeader";
import { toast } from "sonner";

export default function InventorySettings() {
  const { user, companyId } = useAuth();
  const [locations, setLocations] = useState([]);
  const [settings, setSettings] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === "admin";

  const load = async () => {
    setLoading(true);
    const [locs, rows, vendorRows] = await Promise.all([
      base44.entities.Location.filter({ company_id: companyId, is_active: true }),
      base44.entities.InventoryLocationSetting.filter({ company_id: companyId }),
      base44.entities.Vendor.filter({ company_id: companyId }),
    ]);
    setLocations(locs);
    setSettings(rows);
    setVendors(vendorRows);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [companyId]);

  const settingFor = (locationId) =>
    settings.find((row) => row.location_id === locationId) || {
      location_id: locationId,
      type: "location",
      preferred_stock_weeks: 1,
    };

  const updateLocal = (locationId, patch) => {
    setSettings((current) => {
      const existing = current.find((row) => row.location_id === locationId);
      if (existing) {
        return current.map((row) => (row.location_id === locationId ? { ...row, ...patch } : row));
      }
      return [...current, { location_id: locationId, company_id: companyId, type: "location", preferred_stock_weeks: 1, ...patch }];
    });
  };

  const commissaryVendorFor = (location, vendorRows = vendors) =>
    vendorRows.find((vendor) => vendor.commissary_location_id === location.id) ||
    vendorRows.find((vendor) => vendor.is_commissary && vendor.name?.toLowerCase() === location.name.toLowerCase());

  const syncCommissaryVendors = async (savedSettings) => {
    let nextVendors = [...vendors];
    const settingsByLocation = new Map(savedSettings.map((row) => [row.location_id, row]));
    const activeLocationIds = locations.filter((location) => location.is_active !== false).map((location) => location.id);

    for (const location of locations) {
      const row = settingsByLocation.get(location.id) || settingFor(location.id);
      const existing = commissaryVendorFor(location, nextVendors);

      if (row.type === "commissary") {
        const payload = {
          company_id: companyId,
          commissary_location_id: location.id,
          name: location.name,
          order_type: existing?.order_type || "email",
          address: location.address || existing?.address || null,
          notes: existing?.notes || "Auto-created from commissary location",
          is_active: true,
          is_commissary: true,
          authorized_location_ids: existing?.authorized_location_ids?.length > 0 ? existing.authorized_location_ids : activeLocationIds,
          location_settings: existing?.location_settings || [],
          default_order_email: existing?.default_order_email || "",
          default_cc_email: existing?.default_cc_email || "",
          default_min_order_type: existing?.default_min_order_type || "none",
          default_min_order_value: existing?.default_min_order_value ?? null,
          default_delivery_days: existing?.default_delivery_days || [],
          delivery_days: existing?.delivery_days || [],
        };

        if (existing) {
          const updated = await base44.entities.Vendor.update(existing.id, payload);
          nextVendors = nextVendors.map((vendor) => (vendor.id === existing.id ? updated : vendor));
        } else {
          const created = await base44.entities.Vendor.create(payload);
          nextVendors = [...nextVendors, created];
        }
      } else if (existing?.commissary_location_id === location.id) {
        const updated = await base44.entities.Vendor.update(existing.id, {
          commissary_location_id: null,
          is_commissary: false,
          is_active: false,
        });
        nextVendors = nextVendors.map((vendor) => (vendor.id === existing.id ? updated : vendor));
      }
    }

    setVendors(nextVendors);
  };

  const save = async () => {
    setSaving(true);
    try {
      const savedSettings = [];
      for (const location of locations) {
        const row = settingFor(location.id);
        const payload = {
          company_id: companyId,
          location_id: location.id,
          type: row.type || "location",
          preferred_stock_weeks: Number(row.preferred_stock_weeks || 1),
        };
        const saved = row.id
          ? await base44.entities.InventoryLocationSetting.update(row.id, payload)
          : await base44.entities.InventoryLocationSetting.create(payload);
        savedSettings.push(saved);
      }
      await syncCommissaryVendors(savedSettings);
      toast.success("Inventory settings saved");
      await load();
    } catch (error) {
      toast.error(error.message || "Failed to save inventory settings");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <PageHeader title="Inventory Settings" subtitle="Company inventory configuration" />
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Only company admins can change inventory settings.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Inventory Settings"
        subtitle="Configure inventory behavior for Taskr locations"
        actions={<Button onClick={save} disabled={saving || loading}>{saving ? "Saving..." : "Save Settings"}</Button>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Location Inventory Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active Taskr locations found.</p>
          ) : (
            locations.map((location) => {
              const row = settingFor(location.id);
              return (
                <div key={location.id} className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px] gap-3 items-end border border-border rounded-lg p-3">
                  <div>
                    <Label>Location</Label>
                    <p className="mt-2 text-sm font-medium">{location.name}</p>
                    {location.address && <p className="text-xs text-muted-foreground">{location.address}</p>}
                  </div>
                  <div>
                    <Label>Inventory Type</Label>
                    <Select value={row.type || "location"} onValueChange={(type) => updateLocal(location.id, { type })}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="location">Location</SelectItem>
                        <SelectItem value="commissary">Commissary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Stock Weeks</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min="0"
                      step="0.5"
                      value={row.preferred_stock_weeks ?? 1}
                      onChange={(event) => updateLocal(location.id, { preferred_stock_weeks: event.target.value })}
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
