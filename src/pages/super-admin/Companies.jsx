import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Building2, Users, AlertCircle, MapPin, Calendar, Clock, Tag } from "lucide-react";
import { differenceInDays, parseISO } from "date-fns";
import { toast } from "sonner";

export default function SuperAdminCompanies() {
  const [newCompanyOpen, setNewCompanyOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [formData, setFormData] = useState({ email: '', name: '', companyName: '' });
  const [upgradeTier, setUpgradeTier] = useState('1_location');
  const [manageAction, setManageAction] = useState('extend_trial');
  const [extendDays, setExtendDays] = useState(15);
  const [couponCode, setCouponCode] = useState('');
  const [discountMonths, setDiscountMonths] = useState(3);

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

  const manageCompanyMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await base44.functions.invoke('manageCompanyTrial', payload);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        setManageOpen(false);
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

  const handleManage = () => {
    if (selectedCompany) {
      if (manageAction === 'extend_trial') {
        manageCompanyMutation.mutate({ companyId: selectedCompany.id, action: 'extend_trial', days: extendDays });
      } else if (manageAction === 'apply_discount') {
        manageCompanyMutation.mutate({ companyId: selectedCompany.id, action: 'apply_discount', coupon: couponCode, discountMonths });
      } else if (manageAction === 'remove_discount') {
        manageCompanyMutation.mutate({ companyId: selectedCompany.id, action: 'remove_discount' });
      } else {
        manageCompanyMutation.mutate({ companyId: selectedCompany.id, action: 'change_tier', tier: upgradeTier });
      }
    }
  };

  const tierColors = {
    trial: 'bg-yellow-100 text-yellow-800',
    free: 'bg-gray-100 text-gray-800',
    '1_location': 'bg-green-100 text-green-800',
    '5_locations': 'bg-blue-100 text-blue-800',
    unlimited: 'bg-purple-100 text-purple-800'
  };

  const getTrialDaysInfo = (company) => {
    if (company.subscription_tier !== 'trial' || !company.trial_end_date) return null;
    const days = differenceInDays(parseISO(company.trial_end_date), new Date());
    if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, color: 'text-red-600' };
    if (days === 0) return { label: 'Expires today', color: 'text-orange-600' };
    return { label: `${days}d remaining`, color: days <= 7 ? 'text-orange-600' : 'text-muted-foreground' };
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Companies</h1>
          <p className="text-muted-foreground">Manage all companies and subscriptions</p>
        </div>
        <Dialog open={newCompanyOpen} onOpenChange={setNewCompanyOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Company
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
                    : company.subscription_tier === 'free'
                    ? 'Free'
                    : company.subscription_tier.replace('_', ' ')}
                </span>
                {company.trial_expired && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
              {(() => {
                const info = getTrialDaysInfo(company);
                return info ? (
                  <div className={`flex items-center gap-1.5 text-xs ${info.color}`}>
                    <Clock className="h-3.5 w-3.5" />
                    {info.label}
                  </div>
                ) : null;
              })()}
              {company.discount_coupon && (
                <div className="flex items-center gap-1.5 text-xs text-green-700">
                  <Tag className="h-3.5 w-3.5" />
                  Discount: {company.discount_coupon}
                  {company.discount_expires_at && <span className="text-muted-foreground">· expires {company.discount_expires_at}</span>}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{company.admin_email}</p>
              <div className="flex gap-2 pt-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full"
                  onClick={() => {
                    setSelectedCompany(company);
                    setUpgradeTier(['trial','free'].includes(company.subscription_tier) ? '1_location' : company.subscription_tier);
                    setManageAction('extend_trial');
                    setExtendDays(15);
                    setCouponCode('');
                    setDiscountMonths(3);
                    setManageOpen(true);
                  }}
                >
                  <Calendar className="h-4 w-4 mr-1" />
                  Manage
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Company</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Managing: <strong>{selectedCompany?.name}</strong>
            </p>
            <div>
              <Label>Action</Label>
              <Select value={manageAction} onValueChange={setManageAction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="extend_trial">Extend Trial</SelectItem>
                  <SelectItem value="change_tier">Change Tier Manually</SelectItem>
                  <SelectItem value="apply_discount">Apply Discount (Stripe Coupon)</SelectItem>
                  <SelectItem value="remove_discount">Remove Discount</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {manageAction === 'extend_trial' && (
              <div>
                <Label>Days to Extend</Label>
                <Input
                  type="number"
                  value={extendDays}
                  onChange={(e) => setExtendDays(parseInt(e.target.value) || 0)}
                  min="1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Current trial end: {selectedCompany?.trial_end_date || 'Not set'}
                </p>
              </div>
            )}

            {manageAction === 'change_tier' && (
              <div>
                <Label>New Subscription Tier</Label>
                <Select value={upgradeTier} onValueChange={setUpgradeTier}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="free">Free (Super Admin Only)</SelectItem>
                    <SelectItem value="1_location">1 Location - $49/mo</SelectItem>
                    <SelectItem value="5_locations">5 Locations - $149/mo</SelectItem>
                    <SelectItem value="unlimited">Unlimited - $299/mo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {manageAction === 'apply_discount' && (
              <div className="space-y-3">
                <div>
                  <Label>Stripe Coupon / Promo Code ID</Label>
                  <Input
                    placeholder="e.g. SUMMER25"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Enter the coupon ID from your Stripe dashboard.</p>
                </div>
                <div>
                  <Label>Duration (months, informational)</Label>
                  <Input
                    type="number"
                    value={discountMonths}
                    onChange={(e) => setDiscountMonths(parseInt(e.target.value) || 1)}
                    min="1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">For record-keeping only. Stripe controls the actual discount duration.</p>
                </div>
                {selectedCompany?.discount_coupon && (
                  <p className="text-xs text-orange-600">Current coupon: <strong>{selectedCompany.discount_coupon}</strong></p>
                )}
              </div>
            )}

            {manageAction === 'remove_discount' && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm">
                  This will remove the active discount from <strong>{selectedCompany?.name}</strong>'s Stripe subscription.
                  {selectedCompany?.discount_coupon && <span> Current coupon: <strong>{selectedCompany.discount_coupon}</strong></span>}
                </p>
              </div>
            )}

            <Button className="w-full" onClick={handleManage} disabled={manageCompanyMutation.isPending}>
              {manageCompanyMutation.isPending ? 'Updating...' : 'Update Company'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}