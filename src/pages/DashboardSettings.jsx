import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, MapPin, Pencil, Trash2, Building2, ImageIcon, CreditCard, DollarSign, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import TimezoneSelect, { TIMEZONE_UNSET, getBrowserTimezone } from "@/components/shared/TimezoneSelect";
import { toast } from "sonner";

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
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);

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

  // Location state
  const [locDialog, setLocDialog] = useState(false);
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locDrawerAmount, setLocDrawerAmount] = useState("");
  const [locTimezone, setLocTimezone] = useState(getBrowserTimezone());
  const [editLocDialog, setEditLocDialog] = useState(false);
  const [editingLoc, setEditingLoc] = useState(null);
  const [editLocName, setEditLocName] = useState("");
  const [editLocAddress, setEditLocAddress] = useState("");
  const [editLocDrawerAmount, setEditLocDrawerAmount] = useState("");
  const [editLocTimezone, setEditLocTimezone] = useState(TIMEZONE_UNSET);
  const [deleteLocDialog, setDeleteLocDialog] = useState(false);
  const [deletingLoc, setDeletingLoc] = useState(null);
  const [companyDrawerAmount, setCompanyDrawerAmount] = useState("200.00");
  const [companyDrawerSaving, setCompanyDrawerSaving] = useState(false);

  const formatMoneyInput = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : "";
  };

  const normalizeMoney = (value) => Math.max(0, Number.parseFloat(value) || 0);
  const normalizeOptionalMoney = (value) => (String(value).trim() === "" ? null : normalizeMoney(value));
  const hasLocationDrawerOverride = (loc) => loc.cash_drawer_amount !== null && loc.cash_drawer_amount !== undefined;
  const drawerForLocation = (loc) => hasLocationDrawerOverride(loc)
    ? Number(loc.cash_drawer_amount)
    : normalizeMoney(company?.cash_drawer_amount ?? 200);
  const preventNegativeAmountKey = (event) => {
    if (["-", "+", "e", "E"].includes(event.key)) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    if (company) {
      setCompanyDrawerAmount(formatMoneyInput(company.cash_drawer_amount ?? 200));
    }
  }, [company?.id, company?.cash_drawer_amount]);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      console.log("DashboardSettings: Fetching all locations...");
      const result = await base44.entities.Location.list();
      console.log("DashboardSettings: All locations fetched:", result);
      const filtered = result.filter(l => l.company_id === user.company_id);
      console.log("DashboardSettings: Filtered locations:", filtered);
      return filtered;
    },
  });

  // Location limits per tier (must be after locations query)
  const locationLimits = { trial: Infinity, '1_location': 1, '5_locations': 5, unlimited: Infinity };
  const locationLimit = locationLimits[subscriptionTier] ?? Infinity;
  const activeLocations = locations.filter(l => l.is_active).length;
  const atLocationLimit = locationLimit !== Infinity && activeLocations >= locationLimit;

  const addLocation = async () => {
    if (!locName.trim()) return;
    try {
      const res = await base44.functions.invoke('createLocation', {
        name: locName.trim(),
        address: locAddress.trim(),
        cash_drawer_amount: normalizeOptionalMoney(locDrawerAmount),
        timezone: locTimezone === TIMEZONE_UNSET ? null : locTimezone,
      });
      if (res.data.error) {
        toast.error(res.data.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      setLocDialog(false);
      setLocName("");
      setLocAddress("");
      setLocDrawerAmount("");
      setLocTimezone(getBrowserTimezone());
      toast.success("Location added");
    } catch (err) {
      toast.error(err.message || "Failed to add location");
    }
  };

  const toggleLocation = async (loc) => {
    await base44.entities.Location.update(loc.id, { is_active: !loc.is_active });
    queryClient.invalidateQueries({ queryKey: ["locations"] });
  };

  const openEditLoc = (loc) => {
    setEditingLoc(loc);
    setEditLocName(loc.name);
    setEditLocAddress(loc.address || "");
    setEditLocDrawerAmount(hasLocationDrawerOverride(loc) ? formatMoneyInput(loc.cash_drawer_amount) : "");
    setEditLocTimezone(loc.timezone || TIMEZONE_UNSET);
    setEditLocDialog(true);
  };

  const handleEditLoc = async () => {
    if (!editLocName.trim() || !editingLoc) return;
    try {
      await base44.entities.Location.update(editingLoc.id, {
        name: editLocName.trim(),
        address: editLocAddress.trim(),
        cash_drawer_amount: normalizeOptionalMoney(editLocDrawerAmount),
        timezone: editLocTimezone === TIMEZONE_UNSET ? null : editLocTimezone,
      });
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      setEditLocDialog(false);
      toast.success("Location updated");
    } catch (err) {
      toast.error(err.message || "Failed to update location");
    }
  };

  const saveCompanyDrawerAmount = async () => {
    if (!company?.id) return;
    setCompanyDrawerSaving(true);
    await base44.entities.Company.update(company.id, {
      cash_drawer_amount: normalizeMoney(companyDrawerAmount),
    });
    queryClient.invalidateQueries({ queryKey: ["company-info"] });
    setCompanyDrawerSaving(false);
    toast.success("Cash drawer default saved");
  };

  const openDeleteLoc = (loc) => {
    setDeletingLoc(loc);
    setDeleteLocDialog(true);
  };

  const handleDeleteLoc = async () => {
    if (!deletingLoc) return;
    await base44.entities.Location.delete(deletingLoc.id);
    queryClient.invalidateQueries({ queryKey: ["locations"] });
    setDeleteLocDialog(false);
    setDeletingLoc(null);
    toast.success("Location deleted");
  };

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

      {/* Locations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Locations
            {locationLimit !== Infinity && (
              <span className="text-xs font-normal text-muted-foreground ml-1">({activeLocations}/{locationLimit} active)</span>
            )}
          </CardTitle>
          <Button
            size="sm"
            onClick={() => {
              if (atLocationLimit) {
                setUpgradePromptOpen(true);
              } else {
                setLocDialog(true);
              }
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </CardHeader>
        {atLocationLimit && (
          <div className="mx-6 mb-3 flex items-center gap-2 p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>You've reached your <strong>{locationLimit}-location</strong> plan limit. Upgrade to add more locations.</span>
          </div>
        )}
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label>Company Default Cash Drawer ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={companyDrawerAmount}
                  onChange={(e) => setCompanyDrawerAmount(e.target.value)}
                  onKeyDown={preventNegativeAmountKey}
                  className="h-11"
                />
              </div>
              <Button
                onClick={saveCompanyDrawerAmount}
                disabled={!company || companyDrawerSaving}
                className="w-full sm:w-auto"
              >
                {companyDrawerSaving ? "Saving..." : "Save Default"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="flex flex-col gap-3 p-3 rounded-lg bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-sm">{loc.name}</p>
                {loc.address && <p className="text-xs text-muted-foreground">{loc.address}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  Drawer: ${drawerForLocation(loc).toFixed(2)}
                  {!hasLocationDrawerOverride(loc) && " default"}
                  {" · "}
                  {loc.timezone ? loc.timezone.replace(/_/g, " ") : "Timezone not set (UTC)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={loc.is_active} onCheckedChange={() => toggleLocation(loc)} />
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEditLoc(loc)} title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => openDeleteLoc(loc)} title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          </div>
        </CardContent>
      </Card>

      {/* Location Dialog */}
      <Dialog open={locDialog} onOpenChange={setLocDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="e.g. Midtown" /></div>
            <div><Label>Address</Label><Input value={locAddress} onChange={(e) => setLocAddress(e.target.value)} placeholder="Full address" /></div>
            <div>
              <Label>Cash Drawer Amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={locDrawerAmount}
                onChange={(e) => setLocDrawerAmount(e.target.value)}
                onKeyDown={preventNegativeAmountKey}
                placeholder={companyDrawerAmount || "200.00"}
              />
            </div>
            <div>
              <Label>Timezone</Label>
              <TimezoneSelect value={locTimezone} onChange={setLocTimezone} />
              <p className="text-xs text-muted-foreground mt-1">Used for end-of-day inventory snapshots.</p>
            </div>
          </div>
          <DialogFooter><Button onClick={addLocation} disabled={!locName.trim()}>Add Location</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Location Dialog */}
      <Dialog open={editLocDialog} onOpenChange={setEditLocDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Location</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={editLocName} onChange={(e) => setEditLocName(e.target.value)} /></div>
            <div><Label>Address</Label><Input value={editLocAddress} onChange={(e) => setEditLocAddress(e.target.value)} placeholder="Full address" /></div>
            <div>
              <Label>Cash Drawer Amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={editLocDrawerAmount}
                onChange={(e) => setEditLocDrawerAmount(e.target.value)}
                onKeyDown={preventNegativeAmountKey}
                placeholder={companyDrawerAmount || "200.00"}
              />
            </div>
            <div>
              <Label>Timezone</Label>
              <TimezoneSelect value={editLocTimezone} onChange={setEditLocTimezone} />
              <p className="text-xs text-muted-foreground mt-1">Used for end-of-day inventory snapshots.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLocDialog(false)}>Cancel</Button>
            <Button onClick={handleEditLoc} disabled={!editLocName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Delete Location Dialog */}
      <Dialog open={deleteLocDialog} onOpenChange={setDeleteLocDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Location</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deletingLoc?.name}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteLocDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteLoc}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade Prompt Dialog */}
      <Dialog open={upgradePromptOpen} onOpenChange={setUpgradePromptOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-orange-500" /> Location Limit Reached</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your current <strong>{subscriptionTier.replace(/_/g, ' ')}</strong> plan allows up to <strong>{locationLimit} active location{locationLimit === 1 ? '' : 's'}</strong>. Upgrade your plan to add more locations.
          </p>
          <div className="grid gap-2 pt-2">
            {[
              { tier: '5_locations', label: '5 Locations', price: '$149/mo', hidden: subscriptionTier === '5_locations' || subscriptionTier === 'unlimited' },
              { tier: 'unlimited', label: 'Unlimited Locations', price: '$299/mo', hidden: subscriptionTier === 'unlimited' },
            ].filter(p => !p.hidden).map(plan => (
              <Button
                key={plan.tier}
                className="w-full justify-between"
                disabled={checkoutLoading === plan.tier}
                onClick={() => { setUpgradePromptOpen(false); handleCheckout(plan.tier); }}
              >
                <span>{plan.label}</span>
                <span className="text-xs opacity-80">{plan.price}</span>
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradePromptOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
