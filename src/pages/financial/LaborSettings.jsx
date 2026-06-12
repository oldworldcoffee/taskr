import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAppContext } from "@/components/financial/FinancialContext";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Clock, Loader2, CheckCircle2, Settings2 } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function LaborSettings() {
  const { tenant, locations, laborSettings } = useAppContext();
  const { canAccessLocation } = useAuth();

  // Restrict to the taskr locations this user can access (admins/managers see all).
  const accessibleLocations = locations.filter((l) => canAccessLocation(l.id));
  
  // Get location_id from URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocationId = urlParams.get('location_id');
  
  const [selectedLocation, setSelectedLocation] = useState(urlLocationId || accessibleLocations[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [existingSettings, setExistingSettings] = useState(null);
  
  const location = accessibleLocations.find(l => l.id === selectedLocation);
  const locationLaborSettings = laborSettings?.find(l => l.location_id === selectedLocation);
  
  const defaultOperatingHours = {
    0: { open: "09:00", close: "22:00", enabled: true },
    1: { open: "09:00", close: "22:00", enabled: true },
    2: { open: "09:00", close: "22:00", enabled: true },
    3: { open: "09:00", close: "22:00", enabled: true },
    4: { open: "09:00", close: "22:00", enabled: true },
    5: { open: "09:00", close: "23:00", enabled: true },
    6: { open: "09:00", close: "23:00", enabled: true },
  };

  const settingsFromData = (data) => ({
    labor_cost_mode: data?.labor_cost_mode || "simplified",
    hourly_rate: data?.hourly_rate ?? "",
    target_labor_pct: data?.target_labor_pct ?? "",
    floor_hourly_rate: data?.floor_hourly_rate ?? "",
    tax_percentage: data?.tax_percentage ?? "",
    benefits_percentage: data?.benefits_percentage ?? "",
    manager_compensation: data?.manager_compensation ?? "",
    manager_hours_allocated: data?.manager_hours_allocated ?? "",
    labor_cost_offset: data?.labor_cost_offset ?? "",
    operating_hours: data?.operating_hours || defaultOperatingHours
  });

  const [settings, setSettings] = useState(settingsFromData(locationLaborSettings));

  useEffect(() => {
    setSettings(settingsFromData(locationLaborSettings));
  }, [selectedLocation]);

  const { refresh } = useAppContext();
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (!tenant || !location) {
        toast.error("No tenant or location selected");
        setLoading(false);
        return;
      }
      
      // Check if labor settings exist for this location
      const existing = await base44.entities.FinancialLaborSettings.filter({ 
        company_id: tenant.id, 
        location_id: location.id 
      });
      
      if (existing.length > 0) {
        await base44.entities.FinancialLaborSettings.update(existing[0].id, settings);
      } else {
        await base44.entities.FinancialLaborSettings.create({
          company_id: tenant.id,
          location_id: location.id,
          ...settings
        });
      }
      toast.success("Labor settings saved!");
      await refresh();
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to save labor settings:", err);
      toast.error("Failed to save labor settings");
    } finally {
      setLoading(false);
    }
  };

  const updateDay = (dayIndex, field, value) => {
    setSettings(prev => ({
      ...prev,
      operating_hours: {
        ...prev.operating_hours,
        [dayIndex]: {
          ...prev.operating_hours[dayIndex],
          [field]: value
        }
      }
    }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Labor Cost Settings
          </CardTitle>
          <CardDescription>
            Configure your labor costs and targets
          </CardDescription>
        </CardHeader>
        {accessibleLocations.length > 1 && (
          <div className="px-6 pb-4">
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {accessibleLocations.map(loc => (
                  <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Mode Toggle */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Settings2 className="w-4 h-4" /> Labor Cost Mode</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={settings.labor_cost_mode === "simplified" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSettings({...settings, labor_cost_mode: "simplified"})}
                >
                  Simplified
                </Button>
                <Button
                  type="button"
                  variant={settings.labor_cost_mode === "detailed" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSettings({...settings, labor_cost_mode: "detailed"})}
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
                    onChange={(e) => setSettings({...settings, hourly_rate: parseFloat(e.target.value) || 0})}
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
                    onChange={(e) => setSettings({...settings, target_labor_pct: parseFloat(e.target.value) || 0})}
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
                      onChange={(e) => setSettings({...settings, target_labor_pct: parseFloat(e.target.value) || 0})}
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
                      onChange={(e) => setSettings({...settings, floor_hourly_rate: parseFloat(e.target.value) || 0})}
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
                      onChange={(e) => setSettings({...settings, tax_percentage: parseFloat(e.target.value) || 0})}
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
                      onChange={(e) => setSettings({...settings, benefits_percentage: parseFloat(e.target.value) || 0})}
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
                        onChange={(e) => setSettings({...settings, manager_compensation: parseFloat(e.target.value) || 0})}
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
                        onChange={(e) => setSettings({...settings, manager_hours_allocated: parseFloat(e.target.value) || 0})}
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
                    onChange={(e) => setSettings({...settings, labor_cost_offset: parseFloat(e.target.value) || 0})}
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

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : success ? <CheckCircle2 className="w-4 h-4" /> : "Save Settings"}
              </Button>
              {success && <span className="text-sm text-green-600">Saved!</span>}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}