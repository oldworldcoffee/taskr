import { Link, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function InventoryRoute() {
  const { user, userHasFeature, isFeatureEnabledAnywhere } = useAuth();
  // Managers/admins by role, or any user explicitly granted the inventory feature.
  const canUseRole = userHasFeature("inventory");

  const { data: company, isLoading } = useQuery({
    queryKey: ["company-info"],
    enabled: Boolean(user?.company_id && canUseRole),
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyInfo", {});
      return res.data.success ? res.data.company : null;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // company AND location AND user (enabled at any accessible location).
  if (!isFeatureEnabledAnywhere("inventory", company)) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardContent className="py-10 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
            <PackageCheck className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Inventory is not enabled</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ask a super admin to turn on Inventory for this company.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <Outlet />;
}
