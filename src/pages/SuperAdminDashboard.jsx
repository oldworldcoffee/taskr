import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Building2, Users, MapPin, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function SuperAdminDashboard() {
  const [newCompanyOpen, setNewCompanyOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [formData, setFormData] = useState({ email: '', name: '', companyName: '' });
  const [upgradeTier, setUpgradeTier] = useState('1_location');

  const queryClient = useQueryClient();

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAllCompanies', {});
      return res.data.companies;
    }
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data) => {
      const res = await base44.functions.invoke('createCompany', data);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        setNewCompanyOpen(false);
        setFormData({ email: '', name: '', companyName: '' });
        queryClient.invalidateQueries({ queryKey: ['companies'] });
      } else {
        toast.error(data.error);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const updateSubscriptionMutation = useMutation({
    mutationFn: async ({ companyId, tier }) => {
      const res = await base44.functions.invoke('updateCompanySubscription', { companyId, tier });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        setUpgradeOpen(false);
        queryClient.invalidateQueries({ queryKey: ['companies'] });
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
    createCompanyMutation.mutate(formData);
  };

  const handleUpgrade = () => {
    if (selectedCompany) {
      updateSubscriptionMutation.mutate({ companyId: selectedCompany.id, tier: upgradeTier });
    }
  };

  const tierColors = {
    trial: 'bg-yellow-100 text-yellow-800',
    '1_location': 'bg-green-100 text-green-800',
    '5_locations': 'bg-blue-100 text-blue-800',
    unlimited: 'bg-purple-100 text-purple-800'
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Super Admin Dashboard</h1>
          <p className="text-muted-foreground">Manage all companies and subscriptions</p>
        </div>
        <Dialog open={newCompanyOpen} onOpenChange={setNewCompanyOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Company
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Company</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Admin Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={createCompanyMutation.isPending}>
                {createCompanyMutation.isPending ? 'Creating...' : 'Create Company'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {companies?.map((company) => (
          <Card key={company.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {company.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{company.user_count || 0} users</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{company.location_count || 0} locations</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs px-2 py-1 rounded-full ${tierColors[company.subscription_tier]}`}>
                  {company.subscription_tier === 'trial' 
                    ? `Trial${company.trial_expired ? ' (Expired)' : ''}`
                    : company.subscription_tier.replace('_', ' ')}
                </span>
                {company.trial_expired && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">{company.admin_email}</p>
              <div className="flex gap-2 pt-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-1"
                  onClick={() => {
                    setSelectedCompany(company);
                    setUpgradeTier(company.subscription_tier === 'trial' ? '1_location' : company.subscription_tier);
                    setUpgradeOpen(true);
                  }}
                >
                  Upgrade
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade Subscription</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upgrading: <strong>{selectedCompany?.name}</strong>
            </p>
            <div>
              <Label>Subscription Tier</Label>
              <Select value={upgradeTier} onValueChange={setUpgradeTier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1_location">1 Location - $49/mo</SelectItem>
                  <SelectItem value="5_locations">5 Locations - $149/mo</SelectItem>
                  <SelectItem value="unlimited">Unlimited - $299/mo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> Stripe integration placeholder. Configure Stripe products and prices in dashboard settings.
              </p>
            </div>
            <Button className="w-full" onClick={handleUpgrade} disabled={updateSubscriptionMutation.isPending}>
              {updateSubscriptionMutation.isPending ? 'Updating...' : 'Update Subscription'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}