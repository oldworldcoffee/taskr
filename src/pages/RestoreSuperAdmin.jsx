import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

export default function RestoreSuperAdmin() {
  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('restoreSuperAdminAccess', {});
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        // Reload to refresh auth
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.error(data.error);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <Card className="max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-8 w-8 text-primary" />
            <CardTitle>Super Admin Access Required</CardTitle>
          </div>
          <CardDescription>
            Your user account needs super admin privileges to access the platform management area
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5" />
              <p className="text-xs text-yellow-700">
                This is a one-time setup to grant you super admin access for managing the multi-tenant platform.
              </p>
            </div>
          </div>
          <Button 
            className="w-full" 
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
          >
            {restoreMutation.isPending ? 'Restoring Access...' : 'Restore Super Admin Access'}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            After clicking, the page will reload and redirect you to the Super Admin Dashboard
          </p>
        </CardContent>
      </Card>
    </div>
  );
}