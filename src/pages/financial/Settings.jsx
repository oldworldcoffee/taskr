import { Link } from "react-router-dom";
import { useFinancial } from "@/components/financial/FinancialContext";
import ConnectSquareButton from "@/components/financial/ConnectSquareButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Link2, Loader2, Settings2, Sliders } from "lucide-react";

export default function FinancialSettings() {
  const { companyId, tenant, loading, refresh } = useFinancial();
  const connected = Boolean(tenant?.square_connected);

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
          Connect Square for live sales data. Enable Financial per location in
          Settings → Locations.
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
