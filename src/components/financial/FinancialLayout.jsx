import { Outlet, Link } from "react-router-dom";
import { DollarSign } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FinancialProvider } from "@/components/financial/FinancialContext";

export default function FinancialLayout() {
  const { user, userHasFeature } = useAuth();
  // Managers/admins by role, or any user explicitly granted the financial
  // feature (users.feature_permissions.financial). Same idiom as inventory.
  const canUse = Boolean(user?.company_id) && userHasFeature("financial");

  if (!canUse) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardContent className="py-10 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
            <DollarSign className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Financial Management is not available</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Financial Management requires a company admin or manager account, or an explicit grant.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <FinancialProvider>
      <Outlet />
    </FinancialProvider>
  );
}
