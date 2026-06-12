import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, MapPin, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import TimezoneSelect, { TIMEZONE_UNSET, getBrowserTimezone } from "@/components/shared/TimezoneSelect";
import { toast } from "sonner";
import LocationControlPanel from "@/components/locations/LocationControlPanel";
import { normalizeMoney, normalizeOptionalMoney, formatMoneyInput, preventNegativeAmountKey, hasLocationDrawerOverride } from "@/lib/locationFormat";

// Locations management — extracted from DashboardSettings into its own page
// (Settings nav group: Employees / Roles / Locations / General).
export default function DashboardLocations() {
  const { user, refreshLocations } = useAuth();
  const queryClient = useQueryClient();

  const [locDialog, setLocDialog] = useState(false);
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locDrawerAmount, setLocDrawerAmount] = useState("");
  const [locTimezone, setLocTimezone] = useState(getBrowserTimezone());
  const [locType, setLocType] = useState("retail");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelLocation, setPanelLocation] = useState(null);
  const [deleteLocDialog, setDeleteLocDialog] = useState(false);
  const [deletingLoc, setDeletingLoc] = useState(null);
  const [companyDrawerAmount, setCompanyDrawerAmount] = useState("200.00");
  const [companyDrawerSaving, setCompanyDrawerSaving] = useState(false);
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  const { data: company } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCompanyInfo', {});
      return res.data.success ? res.data.company : null;
    }
  });

  const subscriptionTier = company?.subscription_tier || 'trial';

  const drawerForLocation = (loc) => hasLocationDrawerOverride(loc)
    ? Number(loc.cash_drawer_amount)
    : normalizeMoney(company?.cash_drawer_amount ?? 200);

  useEffect(() => {
    if (company) {
      setCompanyDrawerAmount(formatMoneyInput(company.cash_drawer_amount ?? 200));
    }
  }, [company?.id, company?.cash_drawer_amount]);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const result = await base44.entities.Location.list();
      return result.filter(l => l.company_id === user.company_id);
    },
  });

  const locationLimits = { trial: Infinity, '1_location': 1, '5_locations': 5, unlimited: Infinity };
  const locationLimit = locationLimits[subscriptionTier] ?? Infinity;
  const activeLocations = locations.filter(l => l.is_active).length;
  const atLocationLimit = locationLimit !== Infinity && activeLocations >= locationLimit;

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

  const addLocation = async () => {
    if (!locName.trim()) return;
    try {
      const res = await base44.functions.invoke('createLocation', {
        name: locName.trim(),
        address: locAddress.trim(),
        cash_drawer_amount: locType === "roastery" ? null : normalizeOptionalMoney(locDrawerAmount),
        timezone: locTimezone === TIMEZONE_UNSET ? null : locTimezone,
        location_type: locType,
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
      setLocType("retail");
      toast.success("Location added");
    } catch (err) {
      toast.error(err.message || "Failed to add location");
    }
  };

  const toggleLocation = async (loc) => {
    await base44.entities.Location.update(loc.id, { is_active: !loc.is_active });
    queryClient.invalidateQueries({ queryKey: ["locations"] });
  };

  const openLocationPanel = (loc) => {
    setPanelLocation(loc);
    setPanelOpen(true);
  };

  // After the panel saves: refresh the locations list and AuthContext nav gating.
  const handlePanelSaved = async () => {
    queryClient.invalidateQueries({ queryKey: ["locations"] });
    queryClient.invalidateQueries({ queryKey: ["company-info"] });
    await refreshLocations();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Locations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage locations, their modules, and per-location settings
            {locationLimit !== Infinity && ` (${activeLocations}/${locationLimit} active)`}
          </p>
        </div>
        <Button
          onClick={() => {
            if (atLocationLimit) {
              setUpgradePromptOpen(true);
            } else {
              setLocDialog(true);
            }
          }}
        >
          <Plus className="h-4 w-4 mr-1.5" /> Add Location
        </Button>
      </div>

      {atLocationLimit && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>You've reached your <strong>{locationLimit}-location</strong> plan limit. Upgrade to add more locations.</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4" /> All Locations</CardTitle>
        </CardHeader>
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
                  {loc.location_type === "roastery" ? (
                    <span className="capitalize">Roastery</span>
                  ) : (
                    <>
                      Drawer: ${drawerForLocation(loc).toFixed(2)}
                      {!hasLocationDrawerOverride(loc) && " default"}
                    </>
                  )}
                  {" · "}
                  {loc.timezone ? loc.timezone.replace(/_/g, " ") : "Timezone not set (UTC)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={loc.is_active} onCheckedChange={() => toggleLocation(loc)} />
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openLocationPanel(loc)} title="Settings">
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

      {/* Add Location Dialog */}
      <Dialog open={locDialog} onOpenChange={setLocDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="e.g. Midtown" /></div>
            <div><Label>Address</Label><Input value={locAddress} onChange={(e) => setLocAddress(e.target.value)} placeholder="Full address" /></div>
            <div>
              <Label>Location Type</Label>
              <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={locType} onChange={(e) => setLocType(e.target.value)}>
                <option value="retail">Retail</option>
                <option value="roastery">Roastery</option>
                <option value="hybrid">Hybrid (retail + roastery)</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">Roastery or Hybrid locations enable roastery production features.</p>
            </div>
            {locType !== "roastery" && (
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
            )}
            <div>
              <Label>Timezone</Label>
              <TimezoneSelect value={locTimezone} onChange={setLocTimezone} />
              <p className="text-xs text-muted-foreground mt-1">Used for end-of-day inventory snapshots.</p>
            </div>
          </div>
          <DialogFooter><Button onClick={addLocation} disabled={!locName.trim()}>Add Location</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Master Location Control Panel */}
      <LocationControlPanel
        location={panelLocation}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        company={company}
        onSaved={handlePanelSaved}
        onRequestDelete={openDeleteLoc}
      />

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
