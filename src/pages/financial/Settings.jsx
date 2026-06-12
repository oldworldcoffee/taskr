import { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useFinancial } from "@/components/financial/FinancialContext";
import ConnectSquareButton from "@/components/financial/ConnectSquareButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Link2, Loader2, MapPin, Settings2, Sliders } from "lucide-react";
import { toast } from "sonner";

export default function FinancialSettings() {
  const { companyId, tenant, locations, loading, refresh } = useFinancial();
  const [togglingId, setTogglingId] = useState(null);
  const connected = Boolean(tenant?.square_connected);

  const toggleLocation = async (location, isActive) => {
    setTogglingId(location.id);
    try {
      await base44.functions.invoke("financialToggleLocation", {
        location_id: location.id,
        is_active: isActive,
      });
      await refresh();
    } catch (err) {
      toast.error(err.message || "Failed to update location");
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings2 className="h-6 w-6" /> Financial Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Square for live sales data and choose which locations to forecast.
        </p>
      </div>

      {/* Square connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Square Connection
          </CardTitle>
          <CardDescription>
            Pull real sales by day and hour to project labor cost vs. sales.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            {connected ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>
                  Connected{tenant?.square_merchant_id ? ` · Merchant ${tenant.square_merchant_id}` : ""}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Not connected</span>
            )}
          </div>
          <ConnectSquareButton tenantId={companyId} connected={connected} onDisconnect={refresh} />
        </CardContent>
      </Card>

      {/* Locations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" /> Locations
          </CardTitle>
          <CardDescription>
            Square locations are matched to your taskr locations on connect. New ones arrive
            turned off — enable the ones you want to forecast.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {locations.length === 0 && (
            <p className="text-sm text-muted-foreground">No locations yet.</p>
          )}
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{loc.name}</span>
                  {loc.square_location_id && (
                    <Badge variant="secondary" className="text-[10px]">Square</Badge>
                  )}
                </div>
                {loc.address && (
                  <p className="text-xs text-muted-foreground truncate">{loc.address}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {togglingId === loc.id && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                <Switch
                  checked={loc.is_active !== false}
                  disabled={togglingId === loc.id}
                  onCheckedChange={(checked) => toggleLocation(loc, checked)}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Labor settings link */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sliders className="h-5 w-5" /> Labor Settings
          </CardTitle>
          <CardDescription>
            Configure hourly rates, taxes, benefits, and operating hours per location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/dashboard/financial/labor-settings">Open Labor Settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
