import { useState, useEffect, useMemo } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import { formatCurrency, formatLbs } from '@/lib/roasteryPricingUtils';
import PageHeader from '@/components/roastery/PageHeader';
import StatCard from '@/components/roastery/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Package, DollarSign, Clock } from 'lucide-react';
import { format, parseISO, isAfter, startOfDay } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Reports() {
  const { companyId } = useCompany();
  const [lots, setLots] = useState([]);
  const [coffees, setCoffees] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotDate, setSnapshotDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => { if (companyId) loadData(); }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const [lotsData, coffeeData, adjData, invoiceData] = await Promise.all([
      roastery.entities.InventoryLot.filter({ company_id: companyId, is_active: true }),
      roastery.entities.GreenCoffee.filter({ company_id: companyId, is_active: true }),
      roastery.entities.InventoryAdjustment.filter({ company_id: companyId }, '-created_date', 500),
      roastery.entities.Invoice.filter({ company_id: companyId }),
    ]);
    setLots(lotsData);
    setCoffees(coffeeData);
    setAdjustments(adjData);
    setInvoices(invoiceData);
    setLoading(false);
  };

  const coffeeMap = Object.fromEntries(coffees.map(c => [c.id, c]));
  const lotMap = Object.fromEntries(lots.map(l => [l.id, l]));

  // ── Point-in-time snapshot ────────────────────────────────────────────────
  // Walk backwards from current lot values, undoing any adjustments made AFTER the selected date.
  const snapshot = useMemo(() => {
    const cutoff = startOfDay(parseISO(snapshotDate));
    const today = startOfDay(new Date());
    const isToday = cutoff.getTime() === today.getTime();

    if (isToday) {
      // No calculation needed — use current lot values
      return lots.map(l => ({
        lot: l,
        coffee: coffeeMap[l.green_coffee_id],
        lbs_on_hand: l.lbs_on_hand || 0,
        lbs_warehoused: l.lbs_warehoused || 0,
        value: ((l.lbs_on_hand || 0) + (l.lbs_warehoused || 0)) * (l.landed_cost_per_lb || 0),
      }));
    }

    // For each lot, start from current values and subtract adjustments made AFTER cutoff
    return lots.map(l => {
      const lotAdjs = adjustments.filter(a =>
        a.inventory_lot_id === l.id && isAfter(startOfDay(new Date(a.created_date)), cutoff)
      );
      // Undo adjustments that happened after the cutoff date
      const lbsDelta = lotAdjs.reduce((s, a) => s + (a.lbs_adjusted || 0), 0);
      // We don't know split between on_hand / warehoused historically, so apply delta to on_hand
      const historicLbs = Math.max(0, (l.lbs_on_hand || 0) + (l.lbs_warehoused || 0) - lbsDelta);
      return {
        lot: l,
        coffee: coffeeMap[l.green_coffee_id],
        lbs_on_hand: historicLbs,
        lbs_warehoused: 0,
        value: historicLbs * (l.landed_cost_per_lb || 0),
      };
    }).filter(r => r.lbs_on_hand > 0);
  }, [lots, adjustments, coffeeMap, snapshotDate]);

  const snapshotTotalLbs = snapshot.reduce((s, r) => s + r.lbs_on_hand + r.lbs_warehoused, 0);
  const snapshotTotalValue = snapshot.reduce((s, r) => s + r.value, 0);

  // Inventory by coffee for chart — driven by snapshot
  const inventoryByLot = snapshot.map(r => ({
    name: r.coffee?.name || 'Unknown',
    onHand: r.lbs_on_hand,
    warehoused: r.lbs_warehoused,
    value: r.value,
  }));

  // Usage rate from adjustments (roasting_use type, last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentUsage = adjustments.filter(a =>
    a.adjustment_type === 'roasting_use' && new Date(a.created_date) >= thirtyDaysAgo
  );
  const totalUsed30Days = Math.abs(recentUsage.reduce((s, a) => s + (a.lbs_adjusted || 0), 0));
  const dailyUsageRate = totalUsed30Days / 30;
  const weeklyUsageRate = dailyUsageRate * 7;

  // Runout dates (always based on snapshot lbs, usage rate from last 30 days)
  const lotsWithRunout = snapshot.map(({ lot, coffee, lbs_on_hand, lbs_warehoused, value }) => {
    const totalLbs = lbs_on_hand + lbs_warehoused;
    const lotUsage = recentUsage.filter(a => a.inventory_lot_id === lot.id);
    const lotDailyUsage = Math.abs(lotUsage.reduce((s, a) => s + (a.lbs_adjusted || 0), 0)) / 30;
    const daysRemaining = lotDailyUsage > 0 ? Math.round(totalLbs / lotDailyUsage) : null;
    return { lot, coffee, totalLbs, value, daysRemaining };
  }).filter(r => r.totalLbs > 0);

  if (loading) return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-8">
      <PageHeader title="Reports" description="Point-in-time inventory value and on-hand lbs by date" />

      {/* Date selector + snapshot stat cards */}
      <div className="flex items-center gap-3 mb-5">
        <Label className="text-sm font-medium whitespace-nowrap">View inventory as of</Label>
        <Input
          type="date"
          className="w-44 h-8 text-sm"
          value={snapshotDate}
          max={format(new Date(), 'yyyy-MM-dd')}
          onChange={e => setSnapshotDate(e.target.value)}
        />
        {snapshotDate !== format(new Date(), 'yyyy-MM-dd') && (
          <button
            className="text-xs text-muted-foreground underline"
            onClick={() => setSnapshotDate(format(new Date(), 'yyyy-MM-dd'))}
          >
            Reset to today
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Current on-hand value */}
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Current On-Hand Value</p>
              <p className="text-2xl font-semibold mt-1">{formatCurrency(lots.reduce((s,l) => s + ((l.lbs_on_hand||0) * (l.landed_cost_per_lb||0)), 0))}</p>
              <p className="text-xs text-muted-foreground mt-2">{formatLbs(lots.reduce((s,l) => s + (l.lbs_on_hand||0), 0))} lbs at roastery</p>
            </div>
            <div className="p-2.5 bg-accent rounded-lg"><DollarSign className="w-5 h-5 text-accent-foreground" /></div>
          </div>
        </Card>

        {/* Snapshot inventory card */}
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Snapshot Inventory</p>
              <p className="text-2xl font-semibold mt-1">{formatLbs(snapshotTotalLbs)}</p>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span><span className="font-medium text-foreground">{formatLbs(snapshot.reduce((s,r)=>s+r.lbs_on_hand,0))}</span> on-hand</span>
                <span><span className="font-medium text-foreground">{formatLbs(snapshot.reduce((s,r)=>s+r.lbs_warehoused,0))}</span> warehoused</span>
              </div>
            </div>
            <div className="p-2.5 bg-accent rounded-lg"><Package className="w-5 h-5 text-accent-foreground" /></div>
          </div>
        </Card>

        {/* Portfolio value card */}
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Portfolio Value</p>
              <p className="text-2xl font-semibold mt-1">{formatCurrency(snapshotTotalValue)}</p>
              <p className="text-xs text-muted-foreground mt-2">{formatLbs(snapshotTotalLbs)} total</p>
            </div>
            <div className="p-2.5 bg-accent rounded-lg"><DollarSign className="w-5 h-5 text-accent-foreground" /></div>
          </div>
        </Card>

        {/* 30-day usage */}
        <StatCard title="30-Day Usage Rate" value={formatLbs(totalUsed30Days)} subtitle={`~${formatLbs(weeklyUsageRate)}/week`} icon={Clock} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Inventory by coffee bar chart */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Inventory by Coffee (lbs)</CardTitle></CardHeader>
          <CardContent>
            {inventoryByLot.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No inventory data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={inventoryByLot} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)} lbs`} />
                  <Bar dataKey="onHand" name="On Hand" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="warehoused" name="Warehoused" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Value by coffee */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Inventory Value by Coffee ($)</CardTitle></CardHeader>
          <CardContent>
            {inventoryByLot.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No inventory data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={inventoryByLot} margin={{ top: 5, right: 10, left: 10, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <Tooltip formatter={(v) => `$${v.toFixed(2)}`} />
                  <Bar dataKey="value" name="Value" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Runout Dates Table */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Estimated Runout Dates</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 text-xs font-medium text-muted-foreground">Coffee</th>
                <th className="text-right py-2 text-xs font-medium text-muted-foreground">On Hand</th>
                <th className="text-right py-2 text-xs font-medium text-muted-foreground">Warehoused</th>
                <th className="text-right py-2 text-xs font-medium text-muted-foreground">Total</th>
                <th className="text-right py-2 text-xs font-medium text-muted-foreground">Value</th>
                <th className="text-right py-2 text-xs font-medium text-muted-foreground">Est. Days Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lotsWithRunout.map(({ lot, coffee, totalLbs, value, daysRemaining }) => (
                <tr key={lot.id} className="hover:bg-muted/30">
                  <td className="py-2.5 font-medium">{coffee?.name || 'Unknown'}</td>
                  <td className="py-2.5 text-right">{formatLbs(lot.lbs_on_hand)}</td>
                  <td className="py-2.5 text-right">{formatLbs(lot.lbs_warehoused)}</td>
                  <td className="py-2.5 text-right">{formatLbs(totalLbs)}</td>
                  <td className="py-2.5 text-right">{formatCurrency(value)}</td>
                  <td className="py-2.5 text-right">
                    {daysRemaining !== null ? (
                      <span className={daysRemaining < 30 ? 'text-red-600 font-medium' : daysRemaining < 60 ? 'text-yellow-700' : 'text-green-700'}>
                        {daysRemaining} days
                      </span>
                    ) : <span className="text-muted-foreground">No usage data</span>}
                  </td>
                </tr>
              ))}
              {lotsWithRunout.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No inventory lots to report.</td></tr>
              )}
            </tbody>
          </table>
          {lotsWithRunout.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">Runout estimates based on inventory adjustments logged as "roasting_use" in the last 30 days.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}