import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import PageHeader from '@/components/roastery/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Package, Plus, Trash2, Calculator } from 'lucide-react';
import { parseSizeToLbs } from '@/lib/roasteryPricingUtils';

const DEFAULT_BAG_SIZES = [
  { key: '10oz', label: '10 oz', fill_weight_lbs: 10 / 16 },
  { key: '2lb', label: '2 lb', fill_weight_lbs: 2 },
  { key: '5lb', label: '5 lb', fill_weight_lbs: 5 },
];

export default function Settings() {
  const { companyId, settings, isAdmin, refresh } = useCompany();
  const [bagSizes, setBagSizes] = useState(DEFAULT_BAG_SIZES);
  const [newSize, setNewSize] = useState({ label: '', fill_weight_lbs: '' });
  const [savingBags, setSavingBags] = useState(false);
  const [pricingDefaults, setPricingDefaults] = useState({
    weight_loss_pct: 15, target_margin_pct: 64,
    target_retail_margin_pct: 70, retail_markup_pct: 100, bag_costs: {}
  });
  const [savingPricing, setSavingPricing] = useState(false);

  useEffect(() => {
    if (settings) {
      setBagSizes(settings.bag_sizes?.length ? settings.bag_sizes : DEFAULT_BAG_SIZES);
      if (settings.pricing_defaults) {
        setPricingDefaults(d => ({ ...d, ...settings.pricing_defaults, bag_costs: settings.pricing_defaults.bag_costs || {} }));
      }
    }
  }, [settings]);

  const saveSettings = async (patch) => {
    if (settings?.id) {
      await roastery.entities.Settings.update(settings.id, patch);
    } else {
      await roastery.entities.Settings.create({ company_id: companyId, ...patch });
    }
    refresh();
  };

  const saveBagSizes = async () => {
    if (!companyId) return;
    setSavingBags(true);
    try {
      await saveSettings({ bag_sizes: bagSizes });
      toast.success('Bag sizes saved');
    } catch (e) {
      toast.error(e.message || 'Failed to save bag sizes');
    }
    setSavingBags(false);
  };

  const addBagSize = () => {
    const label = newSize.label.trim();
    if (!label) return;
    // Try to auto-calculate fill weight from label if not entered
    let fillLbs = parseFloat(newSize.fill_weight_lbs);
    if (isNaN(fillLbs)) {
      fillLbs = parseSizeToLbs(label);
    }
    if (!fillLbs || fillLbs <= 0) { toast.error('Could not determine fill weight. Please enter it manually.'); return; }
    const key = label.toLowerCase().replace(/\s+/g, '');
    setBagSizes(prev => [...prev, { key, label, fill_weight_lbs: parseFloat(fillLbs.toFixed(4)) }]);
    setNewSize({ label: '', fill_weight_lbs: '' });
  };

  const removeBagSize = (key) => setBagSizes(prev => prev.filter(s => s.key !== key));

  const savePricingDefaults = async () => {
    if (!companyId) return;
    setSavingPricing(true);
    try {
      await saveSettings({ pricing_defaults: pricingDefaults });
      toast.success('Pricing defaults saved');
    } catch (e) {
      toast.error(e.message || 'Failed to save pricing defaults');
    }
    setSavingPricing(false);
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-3xl">
        <PageHeader title="Roastery Settings" description="Bag sizes and pricing defaults" />
        <p className="text-sm text-muted-foreground">Only company admins can change roastery settings.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <PageHeader title="Roastery Settings" description="Bag sizes and pricing defaults for the pricing calculator" />

      {/* Bag Sizes */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4" /> Bag Sizes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Define the bag sizes used in your pricing calculator. Fill weight drives all pricing math.</p>
          <div className="space-y-2">
            {bagSizes.map((size) => (
              <div key={size.key} className="flex items-center gap-3 p-2 rounded-md border bg-muted/30">
                <span className="text-sm font-medium w-24">{size.label}</span>
                <span className="text-xs text-muted-foreground flex-1">{size.fill_weight_lbs.toFixed(4)} lbs fill weight</span>
                <button onClick={() => removeBagSize(size.key)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2 pt-2 border-t">
            <div className="flex-1">
              <Label className="text-xs">Size Label (e.g. 12oz, 1lb, 250g, 1kg)</Label>
              <Input
                className="mt-1"
                placeholder="e.g. 12oz"
                value={newSize.label}
                onChange={e => setNewSize(f => ({ ...f, label: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addBagSize()}
              />
            </div>
            <div className="w-36">
              <Label className="text-xs">Fill Weight (lbs) — optional</Label>
              <Input
                className="mt-1"
                type="number"
                step="0.0001"
                placeholder="auto-calc"
                value={newSize.fill_weight_lbs}
                onChange={e => setNewSize(f => ({ ...f, fill_weight_lbs: e.target.value }))}
              />
            </div>
            <Button variant="outline" size="sm" className="gap-1" onClick={addBagSize}>
              <Plus className="w-4 h-4" /> Add
            </Button>
          </div>
          <Button onClick={saveBagSizes} disabled={savingBags} size="sm">
            {savingBags ? 'Saving...' : 'Save Bag Sizes'}
          </Button>
        </CardContent>
      </Card>

      {/* Pricing Defaults */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="w-4 h-4" /> Pricing Defaults
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">These defaults pre-fill the pricing calculator for every coffee. You can still override them per coffee.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs">Weight Loss %</Label>
              <Input type="number" step="0.1" className="mt-1"
                value={pricingDefaults.weight_loss_pct}
                onChange={e => setPricingDefaults(d => ({ ...d, weight_loss_pct: parseFloat(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Target Wholesale Margin %</Label>
              <Input type="number" step="1" className="mt-1"
                value={pricingDefaults.target_margin_pct}
                onChange={e => setPricingDefaults(d => ({ ...d, target_margin_pct: parseFloat(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Retail Markup %</Label>
              <Input type="number" step="1" className="mt-1"
                value={pricingDefaults.retail_markup_pct}
                onChange={e => setPricingDefaults(d => ({ ...d, retail_markup_pct: parseFloat(e.target.value) }))} />
              <p className="text-[10px] text-muted-foreground mt-0.5">100% = 2× wholesale</p>
            </div>
            <div>
              <Label className="text-xs">Target Retail Margin %</Label>
              <Input type="number" step="1" className="mt-1"
                value={pricingDefaults.target_retail_margin_pct}
                onChange={e => setPricingDefaults(d => ({ ...d, target_retail_margin_pct: parseFloat(e.target.value) }))} />
              <p className="text-[10px] text-muted-foreground mt-0.5">For reporting only</p>
            </div>
          </div>
          {bagSizes.length > 0 && (
            <div>
              <Label className="text-xs mb-2 block">Default Bag Costs</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {bagSizes.map(size => (
                  <div key={size.key}>
                    <Label className="text-xs text-muted-foreground">{size.label}</Label>
                    <Input type="number" step="0.01" className="mt-1" placeholder="0.80"
                      value={pricingDefaults.bag_costs?.[size.key] ?? ''}
                      onChange={e => setPricingDefaults(d => ({
                        ...d, bag_costs: { ...d.bag_costs, [size.key]: parseFloat(e.target.value) }
                      }))} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <Button onClick={savePricingDefaults} disabled={savingPricing} size="sm">
            {savingPricing ? 'Saving...' : 'Save Pricing Defaults'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
