import { Fragment, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Plus, Eye, Download, Layers, DollarSign, CalendarDays, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/ui/StatCard';
import CreatePoolDialog from '@/components/inventory/CreatePoolDialog';
import { activePoolsForItem, applyPoolPurchaseOption, findPoolPurchaseOption, poolRemainingValue, removePoolPurchaseOption } from '@/lib/prepaidPools';
import { format } from 'date-fns';
import { toast } from 'sonner';

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qty(value) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function monthKey(dateText) {
  return String(dateText || '').slice(0, 7);
}

const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-700',
  depleted: 'bg-amber-100 text-amber-700',
  closed: 'bg-gray-100 text-gray-600',
};

function PoolStatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[status] || STATUS_STYLES.closed}`}>
      {status}
    </span>
  );
}

function DepletionBar({ pool }) {
  const total = Number(pool.total_quantity || 0);
  const remaining = Number(pool.remaining_quantity || 0);
  const pct = total > 0 ? Math.max(Math.min((remaining / total) * 100, 100), 0) : 0;
  const negative = remaining < 0;
  return (
    <div className="min-w-[140px]">
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${negative ? 'bg-red-500' : 'bg-primary'}`}
          style={{ width: `${negative ? 100 : pct}%` }}
        />
      </div>
      <p className={`text-xs mt-1 ${negative ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
        {qty(remaining)} of {qty(total)} {pool.unit_of_measure || 'EA'} left
        {negative && ' (overdrawn)'}
      </p>
    </div>
  );
}

const EMPTY_ADJUSTMENT = { quantity: '', location_id: '', drawn_date: '', notes: '' };

export default function Pools() {
  const { companyId, canAccessLocation } = useAuth();
  const isMobile = useIsMobile();

  const [pools, setPools] = useState([]);
  const [drawdowns, setDrawdowns] = useState([]);
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createDialog, setCreateDialog] = useState(false);
  const [detailPool, setDetailPool] = useState(null);
  const [adjustPool, setAdjustPool] = useState(null);
  const [adjustForm, setAdjustForm] = useState(EMPTY_ADJUSTMENT);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [summaryMonth, setSummaryMonth] = useState(format(new Date(), 'yyyy-MM'));

  const load = () => Promise.all([
    base44.entities.PrepaidPool.list('-created_date'),
    base44.entities.PoolDrawdown.list('-drawn_date'),
    base44.entities.InventoryItem.filter({ is_active: true }),
    base44.entities.Location.list(),
    base44.entities.Vendor.list(),
  ]).then(([poolRows, drawRows, itemRows, locationRows, vendorRows]) => {
    setPools(poolRows);
    setDrawdowns(drawRows);
    setItems(itemRows);
    setLocations(locationRows.filter((location) => canAccessLocation(location.id)));
    setVendors(vendorRows);
    setLoading(false);
  }).catch((error) => {
    toast.error(error.message || 'Failed to load prepaid pools');
    setLoading(false);
  });

  useEffect(() => { load(); }, [companyId]);

  const itemName = (id) => items.find((item) => item.id === id)?.name || '—';
  const locationName = (id) => locations.find((location) => location.id === id)?.name || '—';

  const activePools = pools.filter((pool) => pool.status === 'active');
  const totalPrepaidValue = activePools.reduce((sum, pool) => sum + poolRemainingValue(pool), 0);
  const currentMonth = format(new Date(), 'yyyy-MM');
  const drawnThisMonth = drawdowns
    .filter((draw) => monthKey(draw.drawn_date) === currentMonth)
    .reduce((sum, draw) => sum + Number(draw.total_cost || 0), 0);

  const summaryRows = useMemo(() => {
    const monthDraws = drawdowns.filter((draw) => monthKey(draw.drawn_date) === summaryMonth);
    const byLocation = new Map();
    for (const draw of monthDraws) {
      const locationRows = byLocation.get(draw.location_id) || new Map();
      const row = locationRows.get(draw.item_id) || { quantity: 0, cost: 0 };
      row.quantity += Number(draw.quantity || 0);
      row.cost += Number(draw.total_cost || 0);
      locationRows.set(draw.item_id, row);
      byLocation.set(draw.location_id, locationRows);
    }
    return [...byLocation.entries()].map(([locationId, itemRows]) => ({
      locationId,
      items: [...itemRows.entries()].map(([itemId, row]) => ({ itemId, ...row })),
      subtotal: [...itemRows.values()].reduce((sum, row) => sum + row.cost, 0),
    })).sort((a, b) => locationName(a.locationId).localeCompare(locationName(b.locationId)));
  }, [drawdowns, summaryMonth, locations, items]);

  const summaryTotal = summaryRows.reduce((sum, row) => sum + row.subtotal, 0);

  const exportSummaryCsv = () => {
    const lines = [['Location', 'Item', 'Quantity', 'Cost']];
    for (const group of summaryRows) {
      for (const row of group.items) {
        lines.push([locationName(group.locationId), itemName(row.itemId), row.quantity, row.cost.toFixed(2)]);
      }
    }
    lines.push(['Total', '', '', summaryTotal.toFixed(2)]);
    const csv = lines.map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pool-drawdowns-${summaryMonth}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Closing/reopening a pool also moves the item's pool-linked preferred
  // purchase option so recipe costing follows whichever pool is active.
  const setPoolStatus = async (pool, status) => {
    try {
      await base44.entities.PrepaidPool.update(pool.id, { status });
      const item = items.find((i) => i.id === pool.item_id);
      if (item) {
        const otherActive = activePoolsForItem(pools, pool.item_id).filter((p) => p.id !== pool.id);
        let nextOptions = null;
        if (status === 'closed' && findPoolPurchaseOption(item)) {
          nextOptions = otherActive.length
            ? applyPoolPurchaseOption(item, otherActive[0])
            : removePoolPurchaseOption(item);
        } else if (status === 'active' && !otherActive.length) {
          nextOptions = applyPoolPurchaseOption(item, pool);
        }
        if (nextOptions) {
          await base44.entities.InventoryItem.update(item.id, { purchase_options: nextOptions });
        }
      }
      await load();
      toast.success(status === 'closed' ? 'Pool closed' : 'Pool reopened — pool cost is preferred again');
    } catch (error) {
      toast.error(error.message || 'Failed to update pool');
    }
  };

  const openAdjust = (pool) => {
    setAdjustForm({ ...EMPTY_ADJUSTMENT, drawn_date: format(new Date(), 'yyyy-MM-dd') });
    setAdjustPool(pool);
  };

  const saveAdjustment = async () => {
    const quantity = parseFloat(adjustForm.quantity);
    if (!quantity) { toast.error('Enter a non-zero quantity.'); return; }
    if (!adjustForm.location_id) { toast.error('Choose a location for this adjustment.'); return; }

    setSavingAdjustment(true);
    try {
      const unitCost = Number(adjustPool.unit_cost || 0);
      await base44.entities.PoolDrawdown.create({
        pool_id: adjustPool.id,
        item_id: adjustPool.item_id,
        location_id: adjustForm.location_id,
        invoice_id: null,
        quantity,
        unit_cost: unitCost,
        total_cost: quantity * unitCost,
        drawn_date: adjustForm.drawn_date || format(new Date(), 'yyyy-MM-dd'),
        draw_type: 'manual_adjustment',
        notes: String(adjustForm.notes || '').trim(),
      });
      await load();
      setAdjustPool(null);
      toast.success('Adjustment recorded');
    } catch (error) {
      toast.error(error.message || 'Failed to record adjustment');
    } finally {
      setSavingAdjustment(false);
    }
  };

  const detailDrawdowns = detailPool
    ? drawdowns.filter((draw) => draw.pool_id === detailPool.id)
    : [];

  return (
    <div className={isMobile ? 'p-4 max-w-full' : 'p-6 max-w-7xl mx-auto'}>
      <PageHeader
        title="Prepaid Pools"
        subtitle="Bulk purchases the vendor holds for you — drawn down by $0 drop-off invoices at a locked cost"
        actions={<Button onClick={() => setCreateDialog(true)}><Plus className="w-4 h-4 mr-1" />Create Pool</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Prepaid Value (vendor-held)" value={money(totalPrepaidValue)} icon={DollarSign} color="text-primary" />
        <StatCard label="Active Pools" value={activePools.length} icon={Layers} color="text-info" />
        <StatCard label="Drawn This Month" value={money(drawnThisMonth)} icon={CalendarDays} color="text-warning" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : pools.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 bg-card border border-border rounded-xl">
          <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">No prepaid pools yet</p>
          <p className="text-sm mt-1">Create a pool for bulk purchases your vendor warehouses, or convert a line while reviewing the big invoice.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {['Item', 'Label / Vendor', 'Locked Cost', 'Depletion', 'Remaining Value', 'Status', ''].map((heading) => (
                    <th key={heading} className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pools.map((pool) => {
                  const remainingValue = Number(pool.remaining_quantity || 0) * Number(pool.unit_cost || 0);
                  return (
                    <tr key={pool.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{itemName(pool.item_id)}</td>
                      <td className="px-3 py-2">
                        <p className="text-sm">{pool.label || '—'}</p>
                        {pool.vendor_name && <p className="text-xs text-muted-foreground">{pool.vendor_name}</p>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {money(pool.unit_cost)} / {pool.unit_of_measure || 'EA'}
                      </td>
                      <td className="px-3 py-2"><DepletionBar pool={pool} /></td>
                      <td className={`px-3 py-2 whitespace-nowrap ${remainingValue < 0 ? 'text-red-600 font-medium' : ''}`}>{money(remainingValue)}</td>
                      <td className="px-3 py-2"><PoolStatusBadge status={pool.status} /></td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDetailPool(pool)}>
                          <Eye className="w-3.5 h-3.5 mr-1" />View
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openAdjust(pool)}>Adjust</Button>
                        {pool.status === 'closed' ? (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setPoolStatus(pool, 'active')}>Reopen</Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setPoolStatus(pool, 'closed')}>Close</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold text-sm">Monthly Drawdown Summary</h2>
            <p className="text-xs text-muted-foreground">Per-location cost of pool stock consumed — the amounts to move from the balance sheet to COGS.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input type="month" className="h-8 w-40 text-sm" value={summaryMonth} onChange={(e) => setSummaryMonth(e.target.value)} />
            <Button variant="outline" size="sm" className="h-8" onClick={exportSummaryCsv} disabled={!summaryRows.length}>
              <Download className="w-3.5 h-3.5 mr-1" />CSV
            </Button>
          </div>
        </div>
        {summaryRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No pool drawdowns in {summaryMonth}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {['Location', 'Item', 'Quantity', 'Cost'].map((heading) => (
                    <th key={heading} className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((group) => (
                  <Fragment key={group.locationId}>
                    {group.items.map((row, idx) => (
                      <tr key={`${group.locationId}-${row.itemId}`} className="border-b border-border/50">
                        <td className="px-3 py-2">{idx === 0 ? locationName(group.locationId) : ''}</td>
                        <td className="px-3 py-2">{itemName(row.itemId)}</td>
                        <td className="px-3 py-2">{qty(row.quantity)}</td>
                        <td className="px-3 py-2">{money(row.cost)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-border bg-muted/30">
                      <td className="px-3 py-1.5 text-xs font-medium" colSpan={3}>{locationName(group.locationId)} subtotal</td>
                      <td className="px-3 py-1.5 text-xs font-semibold">{money(group.subtotal)}</td>
                    </tr>
                  </Fragment>
                ))}
                <tr>
                  <td className="px-3 py-2 font-semibold" colSpan={3}>Total</td>
                  <td className="px-3 py-2 font-semibold">{money(summaryTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreatePoolDialog
        open={createDialog}
        onClose={() => setCreateDialog(false)}
        items={items}
        vendors={vendors}
        onCreated={() => load()}
      />

      <Dialog open={Boolean(detailPool)} onOpenChange={(open) => { if (!open) setDetailPool(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detailPool ? `${itemName(detailPool.item_id)}${detailPool.label ? ` — ${detailPool.label}` : ''}` : ''}</DialogTitle></DialogHeader>
          {detailPool && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Locked Cost</p><p className="font-medium">{money(detailPool.unit_cost)} / {detailPool.unit_of_measure || 'EA'}</p></div>
                <div><p className="text-xs text-muted-foreground">Total Purchased</p><p className="font-medium">{qty(detailPool.total_quantity)} ({money(detailPool.total_cost)})</p></div>
                <div><p className="text-xs text-muted-foreground">Remaining</p><p className={`font-medium ${Number(detailPool.remaining_quantity) < 0 ? 'text-red-600' : ''}`}>{qty(detailPool.remaining_quantity)}</p></div>
                <div><p className="text-xs text-muted-foreground">Purchased</p><p className="font-medium">{detailPool.purchased_date || '—'}</p></div>
              </div>
              {Number(detailPool.remaining_quantity) < 0 && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  <AlertTriangle className="w-4 h-4" />
                  This pool is overdrawn. Record a manual adjustment to true it up.
                </div>
              )}
              {detailPool.notes && <p className="text-sm text-muted-foreground">{detailPool.notes}</p>}
              <div>
                <h3 className="text-sm font-semibold mb-2">Drawdown History</h3>
                {detailDrawdowns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No drawdowns yet.</p>
                ) : (
                  <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          {['Date', 'Location', 'Type', 'Quantity', 'Cost'].map((heading) => (
                            <th key={heading} className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">{heading}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detailDrawdowns.map((draw) => (
                          <tr key={draw.id} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 whitespace-nowrap">{draw.drawn_date || '—'}</td>
                            <td className="px-3 py-2">{locationName(draw.location_id)}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{draw.draw_type === 'manual_adjustment' ? 'Adjustment' : 'Invoice'}</td>
                            <td className="px-3 py-2">{qty(draw.quantity)}</td>
                            <td className="px-3 py-2">{money(draw.total_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailPool(null)}>Close</Button>
            {detailPool && <Button onClick={() => { openAdjust(detailPool); setDetailPool(null); }}>Manual Adjustment</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(adjustPool)} onOpenChange={(open) => { if (!open) setAdjustPool(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Manual Adjustment{adjustPool ? ` — ${itemName(adjustPool.item_id)}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Positive quantities draw the pool down (counted as consumed cost for that location).
              Negative quantities add stock back (e.g. correcting an over-draw).
            </p>
            <div>
              <Label>Quantity ({adjustPool?.unit_of_measure || 'EA'}) *</Label>
              <Input className="mt-1" type="number" value={adjustForm.quantity} onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <Label>Location *</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
                value={adjustForm.location_id}
                onChange={(e) => setAdjustForm((f) => ({ ...f, location_id: e.target.value }))}
              >
                <option value="">Choose location...</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Date</Label>
              <Input className="mt-1" type="date" value={adjustForm.drawn_date} onChange={(e) => setAdjustForm((f) => ({ ...f, drawn_date: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea className="mt-1 h-16" value={adjustForm.notes} onChange={(e) => setAdjustForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustPool(null)}>Cancel</Button>
            <Button onClick={saveAdjustment} disabled={savingAdjustment}>{savingAdjustment ? 'Saving...' : 'Record Adjustment'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
