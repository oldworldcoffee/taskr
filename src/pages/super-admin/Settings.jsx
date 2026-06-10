import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, DollarSign, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function SuperAdminSettings() {
  const [activeTab, setActiveTab] = useState("pricing");
  const [tiers, setTiers] = useState({
    '1_location': 49,
    '5_locations': 149,
    'unlimited': 299
  });
  const [trialDays, setTrialDays] = useState(15);

  const queryClient = useQueryClient();

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['platform-settings'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getPlatformSettings', {});
      return res.data.settings;
    }
  });

  const savePricingMutation = useMutation({
    mutationFn: async (data) => {
      const res = await base44.functions.invoke('savePricingSettings', data);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Pricing settings saved");
        queryClient.invalidateQueries({ queryKey: ['platform-settings'] });
      } else {
        toast.error(data.error);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const saveTrialMutation = useMutation({
    mutationFn: async (data) => {
      const res = await base44.functions.invoke('saveTrialSettings', data);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Trial settings saved");
        queryClient.invalidateQueries({ queryKey: ['platform-settings'] });
      } else {
        toast.error(data.error);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSavePricing = () => {
    savePricingMutation.mutate({ tiers });
  };

  const handleSaveTrial = () => {
    saveTrialMutation.mutate({ trialDays });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (error) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Platform Settings</h1>
          <p className="text-muted-foreground">Configure Stripe, pricing, and trial periods</p>
        </div>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-start gap-3 p-6 text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold">Could not load settings</h3>
              <p className="mt-1 text-sm">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Platform Settings</h1>
        <p className="text-muted-foreground">Configure Stripe, pricing, and trial periods</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
<TabsTrigger value="pricing" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Pricing & Tiers
          </TabsTrigger>
          <TabsTrigger value="trial" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Trial Period
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pricing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pricing Tiers</CardTitle>
              <CardDescription>
                Configure monthly pricing for each subscription tier
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="tier1">1 Location Tier ($/month)</Label>
                <Input
                  id="tier1"
                  type="number"
                  value={tiers['1_location']}
                  onChange={(e) => setTiers({ ...tiers, '1_location': parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="tier5">5 Locations Tier ($/month)</Label>
                <Input
                  id="tier5"
                  type="number"
                  value={tiers['5_locations']}
                  onChange={(e) => setTiers({ ...tiers, '5_locations': parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="tierUnlimited">Unlimited Tier ($/month)</Label>
                <Input
                  id="tierUnlimited"
                  type="number"
                  value={tiers['unlimited']}
                  onChange={(e) => setTiers({ ...tiers, 'unlimited': parseInt(e.target.value) })}
                />
              </div>
              <Button onClick={handleSavePricing} disabled={savePricingMutation.isPending}>
                {savePricingMutation.isPending ? 'Saving...' : 'Save Pricing'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trial" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Trial Period Settings</CardTitle>
              <CardDescription>
                Configure the default trial period for new companies
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="trialDays">Trial Duration (days)</Label>
                <Input
                  id="trialDays"
                  type="number"
                  value={trialDays}
                  onChange={(e) => setTrialDays(parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  New companies will get {trialDays} days of free trial access
                </p>
              </div>
              <Button onClick={handleSaveTrial} disabled={saveTrialMutation.isPending}>
                {saveTrialMutation.isPending ? 'Saving...' : 'Save Trial Settings'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
