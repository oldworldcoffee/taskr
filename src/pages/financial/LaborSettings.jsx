import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAppContext } from "@/components/financial/FinancialContext";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Loader2, CheckCircle2 } from "lucide-react";
import FinancialLaborSettingsForm from "@/components/locations/modules/FinancialLaborSettingsForm";
import { settingsFromData } from "@/lib/laborSettings";

export default function LaborSettings() {
  const { locations, laborSettings, refresh } = useAppContext();
  const { canAccessLocation } = useAuth();

  // Restrict to the taskr locations this user can access (admins/managers see all)
  // where Financial is enabled.
  const accessibleLocations = locations.filter((l) => canAccessLocation(l.id) && l.is_financial_enabled !== false);

  // Optional location_id from URL parameter (e.g. deep link from a location panel).
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocationId = urlParams.get("location_id");

  const [selectedLocation, setSelectedLocation] = useState(urlLocationId || accessibleLocations[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const location = accessibleLocations.find((l) => l.id === selectedLocation);
  const locationLaborSettings = laborSettings?.find((l) => l.location_id === selectedLocation);

  const [settings, setSettings] = useState(settingsFromData(locationLaborSettings));

  useEffect(() => {
    setSettings(settingsFromData(locationLaborSettings));
  }, [selectedLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!location) {
      toast.error("No location selected");
      return;
    }
    setLoading(true);
    try {
      // Labor settings are absorbed onto the location row.
      await base44.entities.Location.update(location.id, { financial_settings_json: settings });
      toast.success("Labor settings saved!");
      await refresh();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      console.error("Failed to save labor settings:", err);
      toast.error("Failed to save labor settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Labor Cost Settings
          </CardTitle>
          <CardDescription>Configure your labor costs and targets</CardDescription>
        </CardHeader>
        {accessibleLocations.length > 1 && (
          <div className="px-6 pb-4">
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {accessibleLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <FinancialLaborSettingsForm value={settings} onChange={setSettings} />
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
