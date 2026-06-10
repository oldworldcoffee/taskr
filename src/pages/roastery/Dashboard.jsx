import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import { formatCurrency, formatLbs, calcActualMargin, calcWholesalePrice } from '@/lib/roasteryPricingUtils';
import PageHeader from '@/components/roastery/PageHeader';
import StatCard from '@/components/roastery/StatCard';
import StatusBadge from '@/components/roastery/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, Warehouse, DollarSign, AlertTriangle, FileText, Clock, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function Dashboard() {
  const { companyId, company } = useCompany();
  const [lots, setLots] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [rotations, setRotations] = useState([]);
  const [coffees, setCoffees] = useState([]);
  const [pricingRecords, setPricingRecords] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    loadData();
  }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const [lotsData, invoicesData, rotationsData, coffeesData, pricingData, slotsData] = await Promise.all([
      roastery.entities.InventoryLot.filter({ company_id: companyId, is_active: true }),
      roastery.entities.Invoice.filter({ company_id: companyId, status: 'pending_review' }),
      roastery.entities.CategoryRotation.filter({ company_id: companyId, is_current: true }),
      roastery.entities.GreenCoffee.filter({ company_id: companyId, is_active: true }),
      roastery.entities.PricingRecord.filter({ company_id: companyId }),
      roastery.entities.CategorySlot.filter({ company_id: companyId, is_active: true }),
    ]);
    setLots(lotsData);
    setInvoices(invoicesData);
    setRotations(rotationsData);
    setCoffees(coffeesData);
    setPricingRecords(pricingData);
    setSlots(slotsData);
    setLoading(false);
  };

  const totalOnHand = lots.reduce((s, l) => s + (l.lbs_on_hand || 0), 0);
  const totalWarehoused = lots.reduce((s, l) => s + (l.lbs_warehoused || 0), 0);
  const onHandValue = lots.reduce((s, l) => s + (l.lbs_on_hand || 0) * (l.landed_cost_per_lb || 0), 0);
  const warehouseValue = lots.reduce((s, l) => s + (l.lbs_warehoused || 0) * (l.landed_cost_per_lb || 0), 0);

  const coffeeMap = Object.fromEntries(coffees.map(c => [c.id, c]));
  const slotMap = Object.fromEntries(slots.map(s => [s.id, s]));
  const bagSizes = company?.bag_sizes?.length
    ? company.bag_sizes
    : [{ key: '10oz', label: '10 oz', fill_weight_lbs: 10 / 16 }, { key: '2lb', label: '2 lb', fill_weight_lbs: 2 }, { key: '5lb', label: '5 lb', fill_weight_lbs: 5 }];

  // Build out-of-range alerts: compare slot prices vs target margins (same logic as SlotPricingPanel)
  const pricingAlerts = [];
  for (const slot of slots) {
    const slotPrices = Object.fromEntries((slot.slot_prices || []).map(p => [p.size_key, p]));
    for (const size of bagSizes) {
      const slotPrice = slotPrices[size.key]?.wholesale;
      if (!slotPrice) continue;
      
      // Find active rotation for this slot
      const rotation = rotations.find(r => r.category_slot_id === slot.id && ['live_in_store', 'live_online'].includes(r.status));
      if (!rotation) continue;
      
      const coffee = coffeeMap[rotation.green_coffee_id];
      const pricingRec = pricingRecords.find(p => p.green_coffee_id === rotation.green_coffee_id);
      if (!coffee || !pricingRec || !pricingRec.green_cost_per_lb) continue;
      
      const bagCost = pricingRec[`bag_cost_${size.key}`] ?? company?.pricing_defaults?.bag_costs?.[size.key] ?? 0.8;
      const weightLoss = pricingRec.weight_loss_pct ?? 15;
      const targetMargin = pricingRec.target_margin_pct ?? company?.pricing_defaults?.target_margin_pct ?? 64;
      
      const actualMargin = calcActualMargin(slotPrice, pricingRec.green_cost_per_lb, bagCost, weightLoss, size.fill_weight_lbs);
      const delta = actualMargin - targetMargin;
      
      // Calculate recommended/target wholesale price using the proper utility
      const targetWholesale = calcWholesalePrice(pricingRec.green_cost_per_lb, bagCost, targetMargin, weightLoss, size.fill_weight_lbs);
      
      // Same thresholds as SlotPricingPanel: yellow if -8 to -2, red if < -8
      const severity = delta >= -2 ? null : delta >= -8 ? 'yellow' : 'red';
      if (severity) {
        pricingAlerts.push({ coffee, slot, size, actualMargin, targetMargin, delta, slotPrice, targetWholesale, severity });
      }
    }
  }

  if (loading) return (
    <div className="p-8 flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-8">
      <PageHeader
        title={`Welcome back${company?.name ? `, ${company.name}` : ''}`}
        description="Green coffee inventory overview"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="On-Hand Inventory" value={formatLbs(totalOnHand)} subtitle={formatCurrency(onHandValue) + ' value'} icon={Package} />
        <StatCard title="Warehoused" value={formatLbs(totalWarehoused)} subtitle={formatCurrency(warehouseValue) + ' value'} icon={Warehouse} />
        <StatCard title="Total Value" value={formatCurrency(onHandValue + warehouseValue)} subtitle={`${lots.length} active lots`} icon={DollarSign} />
        <StatCard title="Pending Invoices" value={invoices.length} subtitle="Awaiting review" icon={FileText} className={invoices.length > 0 ? 'border-yellow-200 bg-yellow-50' : ''} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Invoices */}
        {invoices.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                Pending Invoice Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {invoices.slice(0, 5).map(inv => (
                  <Link key={inv.id} to="/dashboard/roastery/invoices" className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted transition-colors">
                    <div>
                      <p className="text-sm font-medium">{inv.supplier_name || inv.file_name || 'Invoice'}</p>
                      <p className="text-xs text-muted-foreground">{inv.invoice_date || 'Date unknown'}</p>
                    </div>
                    <StatusBadge status="pending_review" />
                  </Link>
                ))}
              </div>
              <Link to="/dashboard/roastery/invoices">
                <Button variant="outline" size="sm" className="w-full mt-3">View All Invoices</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Needs Review */}
        {(() => {
          const needsReview = rotations.filter(r => r.status === 'waiting_for_input');
          return (
            <Card className={needsReview.length > 0 ? 'border-amber-200 bg-amber-50/40' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Needs Review
                  {needsReview.length > 0 && (
                    <Badge className="ml-1 bg-amber-500 text-white">{needsReview.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {needsReview.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No coffees currently flagged for review.</p>
                ) : (
                  <div className="space-y-2">
                    {needsReview.map(r => {
                      const coffee = coffeeMap[r.green_coffee_id];
                      const slot = slotMap[r.category_slot_id];
                      return (
                        <div key={r.id} className="py-2.5 px-3 rounded-lg border border-amber-200 bg-white">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">{coffee?.name || 'Unknown Coffee'}</p>
                            {slot && <span className="text-xs text-muted-foreground">{slot.name}</span>}
                          </div>
                          {r.notes && (
                            <p className="text-xs text-amber-700 mt-1 italic">"{r.notes}"</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Link to="/dashboard/roastery/release-schedule">
                  <Button variant="outline" size="sm" className="w-full mt-3">Go to Release Schedule</Button>
                </Link>
              </CardContent>
            </Card>
          );
        })()}

        {/* Active Release Slots */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Release Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rotations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No active release slots configured.</p>
            ) : (
              <div className="space-y-2">
                {rotations.slice(0, 6).map(rotation => {
                  const coffee = coffeeMap[rotation.green_coffee_id];
                  return (
                    <div key={rotation.id} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted transition-colors">
                      <div>
                        <p className="text-sm font-medium">{coffee?.name || 'Unknown Coffee'}</p>
                        {rotation.anticipated_rotation_date && (
                          <p className="text-xs text-muted-foreground">Rotation: {rotation.anticipated_rotation_date}</p>
                        )}
                      </div>
                      <StatusBadge status={rotation.status} />
                    </div>
                  );
                })}
              </div>
            )}
            <Link to="/dashboard/roastery/release-schedule">
              <Button variant="outline" size="sm" className="w-full mt-3">Manage Schedule</Button>
            </Link>
          </CardContent>
        </Card>

        {/* Pricing Out of Range */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Pricing Out of Range
              {pricingAlerts.length > 0 && (
                <Badge variant="destructive" className="ml-1">{pricingAlerts.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pricingAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">All pricing records are within target margin range.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-xs font-medium text-muted-foreground">Coffee</th>
                        <th className="text-left py-2 text-xs font-medium text-muted-foreground">Slot</th>
                        <th className="text-left py-2 text-xs font-medium text-muted-foreground">Size</th>
                        <th className="text-right py-2 text-xs font-medium text-muted-foreground">Slot Price</th>
                        <th className="text-right py-2 text-xs font-medium text-muted-foreground">Recommended Price</th>
                        <th className="text-right py-2 text-xs font-medium text-muted-foreground">Actual Margin</th>
                        <th className="text-right py-2 text-xs font-medium text-muted-foreground">Target Margin</th>
                        <th className="text-right py-2 text-xs font-medium text-muted-foreground">Δ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pricingAlerts.map((alert, i) => (
                        <tr key={i} className={`hover:bg-muted/50 ${alert.severity === 'red' ? 'bg-red-50/30' : 'bg-yellow-50/30'}`}>
                          <td className="py-2.5 font-medium">{alert.coffee.name}</td>
                          <td className="py-2.5 text-muted-foreground">{alert.slot?.name || '—'}</td>
                          <td className="py-2.5">{alert.size.label}</td>
                          <td className="py-2.5 text-right font-mono text-xs">{formatCurrency(alert.slotPrice)}</td>
                          <td className="py-2.5 text-right font-mono text-xs text-muted-foreground">{formatCurrency(alert.targetWholesale)}</td>
                          <td className="py-2.5 text-right">{alert.actualMargin.toFixed(1)}%</td>
                          <td className="py-2.5 text-right">{alert.targetMargin.toFixed(1)}%</td>
                          <td className={`py-2.5 text-right font-semibold ${alert.severity === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
                            {alert.delta > 0 ? '+' : ''}{alert.delta.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Link to="/dashboard/roastery/pricing">
                  <Button variant="outline" size="sm" className="w-full mt-3">Review Pricing</Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        {/* Inventory by Coffee */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inventory by Coffee</CardTitle>
          </CardHeader>
          <CardContent>
            {lots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No inventory lots yet. Upload an invoice to get started.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-xs font-medium text-muted-foreground">Coffee</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">On Hand</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">Warehoused</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">$/lb</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lots.map(lot => {
                      const coffee = coffeeMap[lot.green_coffee_id];
                      const totalLbs = (lot.lbs_on_hand || 0) + (lot.lbs_warehoused || 0);
                      const value = totalLbs * (lot.landed_cost_per_lb || 0);
                      return (
                        <tr key={lot.id} className="hover:bg-muted/50">
                          <td className="py-2.5 font-medium">{coffee?.name || 'Unknown'}</td>
                          <td className="py-2.5 text-right">{formatLbs(lot.lbs_on_hand)}</td>
                          <td className="py-2.5 text-right">{formatLbs(lot.lbs_warehoused)}</td>
                          <td className="py-2.5 text-right">{formatCurrency(lot.landed_cost_per_lb)}</td>
                          <td className="py-2.5 text-right font-medium">{formatCurrency(value)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}