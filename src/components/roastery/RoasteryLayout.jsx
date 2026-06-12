import { Link, Outlet } from "react-router-dom";
import { Coffee } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RoasteryProvider } from "./RoasteryContext";

export default function RoasteryLayout() {
  const { user, isFeatureEnabledAnywhere } = useAuth();
  // company AND location AND user. Roastery is enabled by a roastery/hybrid
  // location (or enabled_features) plus the per-location flag, for granted users
  // or admins/managers — at any accessible location.
  const canUse = Boolean(user?.company_id) && isFeatureEnabledAnywhere("roastery");

  if (!canUse) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardContent className="py-10 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
            <Coffee className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Roastery Management is not available</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Roastery Management requires a company admin or manager account.
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
    <RoasteryProvider>
      <Outlet />
    </RoasteryProvider>
  );
}
