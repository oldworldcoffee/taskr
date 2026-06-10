import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import {
  calcRoastedCostPerLb, calcWholesalePrice, calcRetailPrice,
  formatCurrency
} from '@/lib/roasteryPricingUtils';
import PageHeader from '@/components/roastery/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Calculator, Layers } from 'lucide-react';
import { toast } from 'sonner';
import BlendVersionPricing from '@/components/roastery/BlendVersionPricing';
import PricingTable from '@/components/roastery/PricingTable';

const DEFAULT_BAG_SIZES = [
  { key: '10oz', label: '10 oz', fill_weight_lbs: 10 / 16 },
  { key: '2lb', label: '2 lb', fill_weight_lbs: 2 },
  { key: '5lb', label: '5 lb', fill_weight_lbs: 5 },
];


export default function PricingCalculator() {
  const { companyId, isManager, company } = useCompany();
  const [coffees, setCoffees] = useState([]);
  const [lots, setLots] = useState([]);
  const [selectedCoffeeId, setSelectedCoffeeId] = useState('');
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const bagSizes = company?.bag_sizes?.length ? company.bag_sizes : DEFAULT_BAG_SIZES;

  // Build defaults from company.pricing_defaults, falling back to hardcoded values
  const pd = company?.pricing_defaults || {};
  const defaultBagCosts = Object.fromEntries(
    bagSizes.map(s => [`bag_cost_${s.key}`, pd.bag_costs?.[s.key] ?? 0.8])
  );

  const [params, setParams] = useState({
    green_cost_per_lb: '',
    weight_loss_pct: pd.weight_loss_pct ?? 15,
    target_margin_pct: pd.target_margin_pct ?? 64,
    target_retail_margin_pct: pd.target_retail_margin_pct ?? 70,
    retail_markup_pct: pd.retail_markup_pct ?? 100,
    ...defaultBagCosts,
  });


  useEffect(() => { if (companyId) loadBase(); }, [companyId]);
  useEffect(() => { if (selectedCoffeeId) loadRecord(); }, [selectedCoffeeId]);

  const loadBase = async () => {
    setLoading(true);
    const [coffeeData, lotsData] = await Promise.all([
      roastery.entities.GreenCoffee.filter({ company_id: companyId, is_active: true }),
      roastery.entities.InventoryLot.filter({ company_id: companyId, is_active: true }),
    ]);
    setCoffees(coffeeData);
    setLots(lotsData);
    setLoading(false);
  };

  const loadRecord = async () => {
    const records = await roastery.entities.PricingRecord.filter({ company_id: companyId, green_coffee_id: selectedCoffeeId }, '-created_date');
    const existing = records[0];
    if (existing) {
      setRecord(existing);
      const restoredBagCosts = Object.fromEntries(bagSizes.map(s => [`bag_cost_${s.key}`, existing[`bag_cost_${s.key}`] ?? 0.8]));
      setParams({
        green_cost_per_lb: existing.green_cost_per_lb || '',
        weight_loss_pct: existing.weight_loss_pct || 15,
        target_margin_pct: existing.target_margin_pct || 64,
        target_retail_margin_pct: existing.target_retail_margin_pct ?? 70,
        retail_markup_pct: existing.retail_markup_pct ?? 100,
        ...restoredBagCosts,
      });
    } else {
      const selectedCoffee = coffees.find(c => c.id === selectedCoffeeId);
      let blendedCost = '';

      if (selectedCoffee?.coffee_type === 'blend' && selectedCoffee.blend_components?.length) {
        // Weighted average landed cost from component lots
        let totalPct = 0;
        let weightedCost = 0;
        for (const comp of selectedCoffee.blend_components) {
          const lot = lots.find(l => l.green_coffee_id === comp.green_coffee_id);
          const pct = parseFloat(comp.percentage) || 0;
          if (lot?.landed_cost_per_lb && pct > 0) {
            weightedCost += lot.landed_cost_per_lb * pct;
            totalPct += pct;
          }
        }
        if (totalPct > 0) blendedCost = (weightedCost / totalPct).toFixed(4);
      } else {
        const lot = lots.find(l => l.green_coffee_id === selectedCoffeeId);
        blendedCost = lot?.landed_cost_per_lb || '';
      }

      const freshBagCosts = Object.fromEntries(
        bagSizes.map(s => [`bag_cost_${s.key}`, pd.bag_costs?.[s.key] ?? 0.8])
      );
      setParams({
        green_cost_per_lb: blendedCost,
        weight_loss_pct: pd.weight_loss_pct ?? 15,
        target_margin_pct: pd.target_margin_pct ?? 64,
        target_retail_margin_pct: pd.target_retail_margin_pct ?? 70,
        retail_markup_pct: pd.retail_markup_pct ?? 100,
        ...freshBagCosts,
      });
      setRecord(null);
    }
  };

  const greenCost = parseFloat(params.green_cost_per_lb) || 0;
  const selectedCoffee = coffees.find(c => c.id === selectedCoffeeId) || null;

  const calcRow = (size) => {
    const bagCost = params[`bag_cost_${size.key}`] ?? 0.8;
    const wholesale = calcWholesalePrice(greenCost, bagCost, params.target_margin_pct, params.weight_loss_pct, size.fill_weight_lbs);
    const retail = calcRetailPrice(wholesale, params.retail_markup_pct ?? 100);
    return { wholesale, retail };
  };

  const handleSave = async () => {
    if (!selectedCoffeeId || !greenCost) return;
    setSaving(true);
    const calcFields = {};
    bagSizes.forEach(size => {
      const { wholesale, retail } = calcRow(size);
      calcFields[`calc_wholesale_${size.key}`] = wholesale;
      calcFields[`calc_retail_${size.key}`] = retail;
    });

    const payload = {
      company_id: companyId,
      green_coffee_id: selectedCoffeeId,
      ...params,
      green_cost_per_lb: greenCost,
      ...calcFields,
      effective_date: new Date().toISOString().split('T')[0],
    };

    if (record?.id) await roastery.entities.PricingRecord.update(record.id, payload);
    else await roastery.entities.PricingRecord.create(payload);
    toast.success('Pricing saved');
    setSaving(false);
    loadRecord();
  };

  if (loading) return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-8">
      <PageHeader title="Pricing Calculator" description="Recommended vs. actual pricing with margin analysis">
        {isManager && selectedCoffeeId && greenCost && (
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Pricing'}
          </Button>
        )}
      </PageHeader>

      <div className="mb-6">
        <Label>Select Coffee</Label>
        <Select value={selectedCoffeeId} onValueChange={setSelectedCoffeeId}>
          <SelectTrigger className="w-72 mt-1">
            <SelectValue placeholder="Choose a green coffee..." />
          </SelectTrigger>
          <SelectContent>{coffees.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {selectedCoffeeId && (
        <div className="space-y-6">
          {/* Parameters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Calculator className="w-4 h-4" /> Calculation Parameters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
                <div>
                  <Label className="text-xs">Green $/lb</Label>
                  <Input type="number" step="0.01" className="mt-1" value={params.green_cost_per_lb} onChange={e=>setParams(p=>({...p,green_cost_per_lb:e.target.value}))} />
                </div>
                <div>
                  <Label className="text-xs">Weight Loss %</Label>
                  <Input type="number" step="0.1" className="mt-1" value={params.weight_loss_pct} onChange={e=>setParams(p=>({...p,weight_loss_pct:parseFloat(e.target.value)}))} />
                </div>
                <div>
                  <Label className="text-xs">Target Wholesale Margin %</Label>
                  <Input type="number" step="1" className="mt-1" value={params.target_margin_pct} onChange={e=>setParams(p=>({...p,target_margin_pct:parseFloat(e.target.value)}))} />
                </div>
                <div>
                  <Label className="text-xs">Retail Markup %</Label>
                  <Input type="number" step="1" className="mt-1" placeholder="100"
                    value={params.retail_markup_pct ?? 100}
                    onChange={e=>setParams(p=>({...p,retail_markup_pct:parseFloat(e.target.value)}))} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">100% = 2× wholesale</p>
                </div>
                <div>
                  <Label className="text-xs">Target Retail Margin %</Label>
                  <Input type="number" step="1" className="mt-1" placeholder="70"
                    value={params.target_retail_margin_pct ?? 70}
                    onChange={e=>setParams(p=>({...p,target_retail_margin_pct:parseFloat(e.target.value)}))} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">For reporting only</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {bagSizes.map(size => (
                  <div key={size.key}>
                    <Label className="text-xs">{size.label} Bag Cost</Label>
                    <Input type="number" step="0.01" className="mt-1"
                      value={params[`bag_cost_${size.key}`] ?? 0.8}
                      onChange={e=>setParams(p=>({...p,[`bag_cost_${size.key}`]:parseFloat(e.target.value)}))} />
                  </div>
                ))}
              </div>
              {greenCost > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  Roasted cost per lb (after {params.weight_loss_pct}% weight loss): <strong>{formatCurrency(calcRoastedCostPerLb(greenCost, params.weight_loss_pct))}/lb</strong>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Blend: version-aware pricing */}
          {selectedCoffee?.coffee_type === 'blend' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" /> Blend Recipe Versions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BlendVersionPricing
                  blend={selectedCoffee}
                  lots={lots}
                  params={params}
                  bagSizes={bagSizes}
                  coffees={coffees}
                />
              </CardContent>
            </Card>
          )}

          {/* Calculated pricing table (single-origin only) */}
          {selectedCoffee?.coffee_type !== 'blend' && greenCost > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calculator className="w-4 h-4" /> Calculated Pricing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <PricingTable greenCost={greenCost} params={params} bagSizes={bagSizes} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!selectedCoffeeId && (
        <div className="py-20 text-center text-muted-foreground">
          <Calculator className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Select a coffee above to open the pricing calculator.</p>
        </div>
      )}
    </div>
  );
}