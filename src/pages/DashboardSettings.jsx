import { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, ImageIcon, CreditCard, DollarSign, Bell } from "lucide-react";
import PushToggle from "@/components/shared/PushToggle";
import { toast } from "sonner";

// General company settings: brand, billing, notifications.
// Locations management lives at /dashboard/locations (Settings > Locations).
export default function DashboardSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Brand settings
  const [brandName, setBrandName] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef(null);

  const { data: brandData } = useQuery({
    queryKey: ["brand_settings", user.company_id],
    queryFn: async () => {
      const results = await base44.entities.BrandSettings.filter({ company_id: user.company_id });
      return results[0] || null;
    },
  });

  const brandRecord = brandData;
  const displayName = brandName || brandRecord?.business_name || "";
  const displayLogo = brandLogoUrl ?? brandRecord?.logo_url ?? null;

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setBrandLogoUrl(file_url);
    setLogoUploading(false);
  };

  const saveBrand = async () => {
    setBrandSaving(true);
    const payload = {
      business_name: displayName,
      logo_url: displayLogo,
      company_id: user.company_id
    };
    if (brandRecord?.id) {
      await base44.entities.BrandSettings.update(brandRecord.id, payload);
    } else {
      await base44.entities.BrandSettings.create(payload);
    }
    queryClient.invalidateQueries({ queryKey: ["brand_settings"] });
    setBrandSaving(false);
    toast.success("Brand settings saved");
  };

  // Billing state
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  const { data: company } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCompanyInfo', {});
      return res.data.success ? res.data.company : null;
    }
  });

  // Check for payment success/cancel in URL
  const urlParams = new URLSearchParams(window.location.search);
  const paymentStatus = urlParams.get('payment');
  if (paymentStatus === 'success') {
    toast.success('Subscription activated! Welcome aboard.');
    window.history.replaceState({}, '', window.location.pathname);
  }

  const handleCheckout = async (tier) => {
    setCheckoutLoading(tier);
    const res = await base44.functions.invoke('createCheckoutSession', { tier });
    if (res.data?.url) {
      window.location.href = res.data.url;
    } else {
      toast.error(res.data?.error || 'Failed to start checkout');
      setCheckoutLoading(null);
    }
  };

  const subscriptionTier = company?.subscription_tier || 'trial';
  const isTrialExpired = company?.trial_expired;

  if (user?.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Brand */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Brand & Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className="h-16 w-16 rounded-xl border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-muted/40 transition-colors overflow-hidden flex-shrink-0"
              onClick={() => logoInputRef.current?.click()}
              title="Upload logo"
            >
              {displayLogo ? (
                <img src={displayLogo} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <div className="flex-1 space-y-1">
              <Label>Business Name</Label>
              <Input
                value={displayName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g. OWCR Operations"
              />
              <p className="text-xs text-muted-foreground">Click the box on the left to upload a logo.</p>
            </div>
          </div>
          {logoUploading && <p className="text-xs text-muted-foreground">Uploading logo…</p>}

          <div className="flex justify-end">
            <Button size="sm" onClick={saveBrand} disabled={brandSaving || logoUploading}>
              {brandSaving ? "Saving…" : "Save Brand"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Billing */}
      {company && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" /> Billing & Subscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between pb-4 border-b">
              <div>
                <p className="font-medium text-sm">Current Plan</p>
                <p className={`text-sm ${isTrialExpired ? 'text-destructive' : 'text-success'}`}>
                  {subscriptionTier === 'trial'
                    ? `Trial${isTrialExpired ? ' (Expired)' : ''}`
                    : subscriptionTier.replace(/_/g, ' ')}
                </p>
                {subscriptionTier === 'trial' && company.trial_end_date && (
                  <p className="text-xs text-muted-foreground">Ends: {new Date(company.trial_end_date).toLocaleDateString()}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">
                  {subscriptionTier === 'trial' ? '$0' :
                   subscriptionTier === '1_location' ? '$49' :
                   subscriptionTier === '5_locations' ? '$149' : '$299'}
                </p>
                <p className="text-xs text-muted-foreground">/month</p>
              </div>
            </div>

            <p className="text-sm font-medium">Available Plans</p>
            <div className="grid gap-2">
              {[
                { tier: '1_location', label: '1 Location', desc: 'Perfect for single store', price: '$49' },
                { tier: '5_locations', label: '5 Locations', desc: 'Great for small chains', price: '$149' },
                { tier: 'unlimited', label: 'Unlimited', desc: 'For growing businesses', price: '$299' },
              ].map(plan => (
                <div
                  key={plan.tier}
                  className={`p-3 rounded-lg border transition-all ${plan.tier === subscriptionTier ? 'border-primary bg-primary/5' : 'hover:border-primary hover:bg-primary/5'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{plan.label}</span>
                      {plan.tier === subscriptionTier && (
                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">Current</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{plan.price}/mo</span>
                      {plan.tier !== subscriptionTier && (
                        <Button
                          size="sm"
                          disabled={checkoutLoading === plan.tier}
                          onClick={() => handleCheckout(plan.tier)}
                        >
                          {checkoutLoading === plan.tier ? 'Loading…' : plan.tier === 'trial' ? 'Downgrade' : 'Subscribe'}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{plan.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notifications */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" /> Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <PushToggle />
        </CardContent>
      </Card>
    </div>
  );
}
