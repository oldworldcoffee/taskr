import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, CheckCircle2, AlertCircle, Building2 } from "lucide-react";
import { toast } from "sonner";

export default function Setup() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("Old World Coffee Roasters");
  const [adminEmail, setAdminEmail] = useState(user?.email || "");

  const setSuperAdminMutation = useMutation({
    mutationFn: async (email) => {
      const res = await base44.functions.invoke('grantFirstSuperAdmin', { 
        targetEmail: email
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        setEmail("");
        // Reload to refresh auth context
        setTimeout(() => window.location.reload(), 1000);
      } else {
        toast.error(data.error);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    // If email matches current user, skip API call and just reload
    if (email === user?.email || !email) {
      toast.success("As app owner, you already have super admin access. Proceeding to Step 2...");
      setTimeout(() => window.location.reload(), 1000);
      return;
    }
    setSuperAdminMutation.mutate(email);
  };

  const migrateCompanyMutation = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('migrateExistingCompany', { 
        companyName,
        adminEmail
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        // Refresh to show new role
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
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Multi-Tenant Setup</h1>
            <p className="text-muted-foreground">Get started with the new SaaS structure</p>
          </div>
        </div>

        {user?.role === 'super_admin' ? (
          <Card className="border-green-500 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-800">
                <CheckCircle2 className="h-5 w-5" />
                You're a Super Admin
              </CardTitle>
              <CardDescription className="text-green-700">
                You have full access to manage all companies
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-green-900">
                  Next steps:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm text-green-900">
                  <li>Complete Step 2 below to migrate your data</li>
                  <li>Go to <a href="/super-admin" className="underline font-medium">Super Admin Dashboard</a></li>
                  <li>Create additional companies or manage subscriptions</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Step 1: Verify Super Admin Access</CardTitle>
                <CardDescription>
                  As the app owner, you already have super admin access
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="border-blue-500 bg-blue-50">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-sm text-blue-800">
                    You're logged in as <strong>{user?.email}</strong>. As the app owner, you automatically have super admin privileges.
                  </AlertDescription>
                </Alert>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="email">Your Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={user?.email || "your@email.com"}
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={setSuperAdminMutation.isPending}
                  >
                    {setSuperAdminMutation.isPending ? 'Verifying...' : 'Confirm & Continue to Step 2'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Step 2: Migrate Old World Coffee Roasters
                </CardTitle>
                <CardDescription>
                  Convert your existing data to the new multi-tenant structure
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    This will create a company record and link all your existing locations, users, and data to it.
                  </AlertDescription>
                </Alert>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="adminEmail">Company Admin Email</Label>
                    <Input
                      id="adminEmail"
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@company.com"
                    />
                  </div>
                  <Button 
                    onClick={() => migrateCompanyMutation.mutate()}
                    className="w-full"
                    disabled={migrateCompanyMutation.isPending}
                  >
                    {migrateCompanyMutation.isPending ? 'Migrating...' : 'Migrate Existing Data to Company'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
              <p><strong>Create Companies:</strong> As super admin, create companies for your clients with 15-day free trials</p>
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
              <p><strong>Company Admins:</strong> Each company admin can manage their own locations and employees</p>
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">3</div>
              <p><strong>Subscription Tiers:</strong> Upgrade companies to paid plans (1, 5, or unlimited locations)</p>
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">4</div>
              <p><strong>Stripe Integration:</strong> Placeholder ready - activate when you configure Stripe products</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}