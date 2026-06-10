import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import { formatCurrency, formatLbs } from '@/lib/roasteryPricingUtils';
import PageHeader from '@/components/roastery/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, ArrowUpDown, MoveRight, Archive, ArchiveRestore } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const BAG_SIZES = [
  { label: '69 kg (152 lbs)', kg: 69 },
  { label: '30 kg (66 lbs)', kg: 30 },
  { label: 'Custom', kg: 'custom' },
];

const kgToLbs = (kg) => parseFloat((kg * 2.20462).toFixed(1));
import { toast } from 'sonner';

export default function Inventory() {
  const { companyId, isManager } = useCompany();
  const [lots, setLots] = useState([]);
  const [coffees, setCoffees] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adjustDialog, setAdjustDialog] = useState(null);
  const [addLotDialog, setAddLotDialog] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ lbs_adjusted: '', actual_weight: '', location: 'on_hand', reason: '' });
  const [newLot, setNewLot] = useState({ green_coffee_id: '', lbs_on_hand: '', lbs_warehoused: '', green_cost_per_lb: '', warehouse_location_id: '', number_of_bags: '', bag_size_kg: '', custom_bag_size_kg: '' });
  const [editLotDialog, setEditLotDialog] = useState(null);
  const [transferDialog, setTransferDialog] = useState(null);
  const [transferForm, setTransferForm] = useState({ lbs: '', direction: 'warehouse_to_hand' });
  const [showArchived, setShowArchived] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    loadData();
  }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const [lotsData, coffeesData, warehousesData] = await Promise.all([
      roastery.entities.InventoryLot.filter({ company_id: companyId }),
      roastery.entities.GreenCoffee.filter({ company_id: companyId }),
      roastery.entities.WarehouseLocation.filter({ company_id: companyId }),
    ]);
    setLots(lotsData);
    setCoffees(coffeesData);
    setWarehouses(warehousesData);
    setLoading(false);
  };

  const handleArchiveLot = async (lot) => {
    await roastery.entities.InventoryLot.update(lot.id, { is_active: false });
    toast.success('Lot archived');
    setConfirmArchive(null);
    loadData();
  };

  const handleUnarchiveLot = async (lot) => {
    await roastery.entities.InventoryLot.update(lot.id, { is_active: true });
    toast.success('Lot restored');
    loadData();
  };

  const coffeeMap = Object.fromEntries(coffees.map(c => [c.id, c]));
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w]));
  const visibleLots = lots.filter(l => showArchived ? l.is_active === false : l.is_active !== false);

  const handleAdjust = async () => {
    const lot = adjustDialog;
    const adj = parseFloat(adjustForm.lbs_adjusted);
    if (!adj) return;
    const before = adjustForm.location === 'on_hand' ? (lot.lbs_on_hand || 0) : (lot.lbs_warehoused || 0);
    const after = before + adj;
    const update = adjustForm.location === 'on_hand'
      ? { lbs_on_hand: Math.max(0, after) }
      : { lbs_warehoused: Math.max(0, after) };

    await roastery.entities.InventoryLot.update(lot.id, update);
    await roastery.entities.InventoryAdjustment.create({
      company_id: companyId,
      inventory_lot_id: lot.id,
      green_coffee_id: lot.green_coffee_id,
      adjustment_type: 'physical_count',
      lbs_before: before,
      lbs_adjusted: adj,
      lbs_after: Math.max(0, after),
      location: adjustForm.location,
      reason: adjustForm.reason,
      adjustment_date: new Date().toISOString().split('T')[0],
    });
    toast.success('Inventory adjusted');
    setAdjustDialog(null);
    setAdjustForm({ lbs_adjusted: '', actual_weight: '', location: 'on_hand', reason: '' });
    loadData();
  };

  const handleEditLot = async () => {
    const lot = editLotDialog;
    const bags = parseFloat(lot.number_of_bags) || 0;
    const bagSizeKg = lot.bag_size_kg === 'custom' ? (parseFloat(lot.custom_bag_size_kg) || 0) : (parseFloat(lot.bag_size_kg) || 0);
    const calcedLbs = bagSizeKg > 0 ? kgToLbs(bags * bagSizeKg) : null;
    await roastery.entities.InventoryLot.update(lot.id, {
      green_coffee_id: lot.green_coffee_id,
      lbs_on_hand: calcedLbs !== null ? calcedLbs : (parseFloat(lot.lbs_on_hand) || 0),
      lbs_warehoused: parseFloat(lot.lbs_warehoused) || 0,
      green_cost_per_lb: parseFloat(lot.green_cost_per_lb) || 0,
      landed_cost_per_lb: parseFloat(lot.landed_cost_per_lb || lot.green_cost_per_lb) || 0,
      number_of_bags: bags,
      bag_size_kg: bagSizeKg || null,
      warehouse_location_id: lot.warehouse_location_id || null,
      arrival_date: lot.arrival_date || null,
      notes: lot.notes || '',
    });
    toast.success('Lot updated');
    setEditLotDialog(null);
    loadData();
  };

  const handleTransfer = async () => {
    const lot = transferDialog;
    const bags = parseFloat(transferForm.lbs);
    if (!bags || bags <= 0) return;

    const lbsPerBag = lot.bag_size_kg ? kgToLbs(lot.bag_size_kg) : 1;
    const lbs = bags * lbsPerBag;

    const fromWarehouse = transferForm.direction === 'warehouse_to_hand';
    const available = fromWarehouse ? (lot.lbs_warehoused || 0) : (lot.lbs_on_hand || 0);
    const moved = Math.min(lbs, available);

    const newOnHand = fromWarehouse
      ? (lot.lbs_on_hand || 0) + moved
      : Math.max(0, (lot.lbs_on_hand || 0) - moved);
    const newWarehoused = fromWarehouse
      ? Math.max(0, (lot.lbs_warehoused || 0) - moved)
      : (lot.lbs_warehoused || 0) + moved;

    await roastery.entities.InventoryLot.update(lot.id, {
      lbs_on_hand: newOnHand,
      lbs_warehoused: newWarehoused,
    });
    await roastery.entities.InventoryAdjustment.create({
      company_id: companyId,
      inventory_lot_id: lot.id,
      green_coffee_id: lot.green_coffee_id,
      adjustment_type: 'transfer_to_roastery',
      lbs_before: fromWarehouse ? lot.lbs_warehoused : lot.lbs_on_hand,
      lbs_adjusted: fromWarehouse ? -moved : moved,
      lbs_after: fromWarehouse ? newWarehoused : newOnHand,
      location: fromWarehouse ? 'warehoused' : 'on_hand',
      reason: fromWarehouse ? 'Transfer: warehouse → roastery' : 'Transfer: roastery → warehouse',
      adjustment_date: new Date().toISOString().split('T')[0],
    });
    toast.success(`Transferred ${formatLbs(moved)} ${fromWarehouse ? 'to On Hand' : 'to Warehouse'}`);
    setTransferDialog(null);
    setTransferForm({ lbs: '', direction: 'warehouse_to_hand' });
    loadData();
  };

  const calcLbsFromBags = (numBags, bagSizeKg, customKg) => {
    const bags = parseFloat(numBags) || 0;
    const sizeKg = bagSizeKg === 'custom' ? (parseFloat(customKg) || 0) : (parseFloat(bagSizeKg) || 0);
    return sizeKg > 0 ? kgToLbs(bags * sizeKg) : null;
  };

  const handleAddLot = async () => {
    const landed = parseFloat(newLot.green_cost_per_lb) || 0;
    const bags = parseFloat(newLot.number_of_bags) || 0;
    const bagSizeKg = newLot.bag_size_kg === 'custom' ? (parseFloat(newLot.custom_bag_size_kg) || 0) : (parseFloat(newLot.bag_size_kg) || 0);
    const totalLbs = bagSizeKg > 0 ? kgToLbs(bags * bagSizeKg) : (parseFloat(newLot.lbs_on_hand) || 0);

    const selectedWarehouse = warehouses.find(w => w.id === newLot.warehouse_location_id);
    const isOffSite = selectedWarehouse?.location_type === 'off_site';

    await roastery.entities.InventoryLot.create({
      company_id: companyId,
      green_coffee_id: newLot.green_coffee_id,
      warehouse_location_id: newLot.warehouse_location_id || null,
      lbs_on_hand: isOffSite ? 0 : totalLbs,
      lbs_warehoused: isOffSite ? totalLbs : 0,
      green_cost_per_lb: landed,
      landed_cost_per_lb: landed,
      number_of_bags: bags,
      bag_size_kg: bagSizeKg || null,
      is_active: true,
    });
    toast.success('Lot added');
    setAddLotDialog(false);
    setNewLot({ green_coffee_id: '', lbs_on_hand: '', lbs_warehoused: '', green_cost_per_lb: '', warehouse_location_id: '', number_of_bags: '', bag_size_kg: '', custom_bag_size_kg: '' });
    loadData();
  };

  if (loading) return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-8">
      <PageHeader title="Green Coffee Inventory" description="Track on-hand and warehoused green coffee by lot">
        <Button variant="outline" onClick={() => setShowArchived(a => !a)} className="gap-2">
          {showArchived ? <><ArchiveRestore className="w-4 h-4" /> View Active</> : <><Archive className="w-4 h-4" /> View Archived</>}
        </Button>
        {isManager && !showArchived && (
          <Button onClick={() => setAddLotDialog(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Lot
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total On Hand</p>
          <p className="text-xl font-semibold mt-1">{formatLbs(visibleLots.reduce((s,l)=>s+(l.lbs_on_hand||0),0))}</p>
          <p className="text-xs text-muted-foreground">{formatCurrency(visibleLots.reduce((s,l)=>s+(l.lbs_on_hand||0)*(l.landed_cost_per_lb||0),0))} value</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Warehoused</p>
          <p className="text-xl font-semibold mt-1">{formatLbs(visibleLots.reduce((s,l)=>s+(l.lbs_warehoused||0),0))}</p>
          <p className="text-xs text-muted-foreground">{formatCurrency(visibleLots.reduce((s,l)=>s+(l.lbs_warehoused||0)*(l.landed_cost_per_lb||0),0))} value</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Value</p>
          <p className="text-xl font-semibold mt-1">{formatCurrency(visibleLots.reduce((s,l)=>s+((l.lbs_on_hand||0)+(l.lbs_warehoused||0))*(l.landed_cost_per_lb||0),0))}</p>
          <p className="text-xs text-muted-foreground">{visibleLots.length} {showArchived ? 'archived' : 'active'} lots</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Coffee</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">On Hand</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Warehoused</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Bags</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">$/lb (landed)</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Total Value</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Warehouse</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleLots.map(lot => {
                  const coffee = coffeeMap[lot.green_coffee_id];
                  const warehouse = warehouseMap[lot.warehouse_location_id];
                  const totalLbs = (lot.lbs_on_hand || 0) + (lot.lbs_warehoused || 0);
                  return (
                    <tr key={lot.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-medium">{coffee?.name || '—'}</p>
                        {coffee?.country && <p className="text-xs text-muted-foreground">{coffee.country}</p>}
                      </td>
                      <td className="py-3 px-4 text-right">{formatLbs(lot.lbs_on_hand)}</td>
                      <td className="py-3 px-4 text-right">{formatLbs(lot.lbs_warehoused)}</td>
                      <td className="py-3 px-4 text-right">
                        {lot.number_of_bags || '—'}
                        {lot.bag_size_kg && <span className="text-xs text-muted-foreground ml-1">× {lot.bag_size_kg}kg</span>}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{formatCurrency(lot.landed_cost_per_lb)}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(totalLbs * (lot.landed_cost_per_lb || 0))}</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{warehouse?.name || '—'}</td>
                      <td className="py-3 px-4">
                        {isManager && (
                          <div className="flex gap-1">
                            {!showArchived ? (
                              <>
                                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => { setTransferDialog(lot); setTransferForm({ lbs: '', direction: 'warehouse_to_hand' }); }}>
                                  <MoveRight className="w-3 h-3" /> Transfer
                                </Button>
                                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setAdjustDialog(lot)}>
                                  <ArrowUpDown className="w-3 h-3" /> Adjust
                                </Button>
                                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setEditLotDialog({ ...lot })}>
                                  <Pencil className="w-3 h-3" /> Edit
                                </Button>
                                <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setConfirmArchive(lot)}>
                                  <Archive className="w-3 h-3" /> Archive
                                </Button>
                              </>
                            ) : (
                              <Button variant="ghost" size="sm" className="gap-1 text-xs text-green-600 hover:text-green-700" onClick={() => handleUnarchiveLot(lot)}>
                                <ArchiveRestore className="w-3 h-3" /> Restore
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleLots.length === 0 && (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">{showArchived ? 'No archived lots.' : 'No inventory lots yet.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Archive Lot Confirmation */}
      <AlertDialog open={!!confirmArchive} onOpenChange={(open) => { if (!open) setConfirmArchive(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Lot?</AlertDialogTitle>
            <AlertDialogDescription>
              This lot will be hidden from the active inventory. You can restore it anytime from the "View Archived" view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleArchiveLot(confirmArchive)}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transfer Dialog */}
      <Dialog open={!!transferDialog} onOpenChange={() => setTransferDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Inventory — {coffeeMap[transferDialog?.green_coffee_id]?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Direction</Label>
              <Select value={transferForm.direction} onValueChange={v => setTransferForm(f => ({ ...f, direction: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warehouse_to_hand">Warehouse → On Hand (Pull to roastery)</SelectItem>
                  <SelectItem value="hand_to_warehouse">On Hand → Warehouse (Send to warehouse)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {transferForm.direction === 'warehouse_to_hand' ? (
                <>Available at warehouse: <span className="font-semibold text-foreground">
                  {transferDialog?.bag_size_kg
                    ? `${Math.floor((transferDialog.lbs_warehoused || 0) / kgToLbs(transferDialog.bag_size_kg))} bags`
                    : formatLbs(transferDialog?.lbs_warehoused)}
                </span></>
              ) : (
                <>Available on hand: <span className="font-semibold text-foreground">
                  {transferDialog?.bag_size_kg
                    ? `${Math.floor((transferDialog.lbs_on_hand || 0) / kgToLbs(transferDialog.bag_size_kg))} bags`
                    : formatLbs(transferDialog?.lbs_on_hand)}
                </span></>
              )}
            </div>
            <div>
              <Label>Number of Bags to Transfer</Label>
              <Input
                type="number"
                value={transferForm.lbs}
                onChange={e => setTransferForm(f => ({ ...f, lbs: e.target.value }))}
                placeholder="e.g. 3"
              />
              {transferForm.lbs && transferDialog?.bag_size_kg && (
                <p className="text-xs text-muted-foreground mt-1">
                  ≈ {formatLbs(parseFloat(transferForm.lbs) * kgToLbs(transferDialog.bag_size_kg))} lbs
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(null)}>Cancel</Button>
            <Button onClick={handleTransfer} disabled={!transferForm.lbs || parseFloat(transferForm.lbs) <= 0}>
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust Dialog */}
      <Dialog open={!!adjustDialog} onOpenChange={() => setAdjustDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Inventory — {coffeeMap[adjustDialog?.green_coffee_id]?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Location</Label>
              <Select value={adjustForm.location} onValueChange={v => setAdjustForm(f=>({...f, location:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on_hand">On Hand (Roastery)</SelectItem>
                  <SelectItem value="warehoused">Warehoused (Off-site)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Actual Weight on Hand (lbs)</Label>
              <Input
                type="number"
                step="0.1"
                value={adjustForm.actual_weight}
                onChange={e => {
                  const actual = parseFloat(e.target.value);
                  const current = adjustForm.location === 'on_hand'
                    ? (adjustDialog?.lbs_on_hand || 0)
                    : (adjustDialog?.lbs_warehoused || 0);
                  const diff = isNaN(actual) ? '' : parseFloat((actual - current).toFixed(1));
                  setAdjustForm(f => ({ ...f, actual_weight: e.target.value, lbs_adjusted: isNaN(actual) ? '' : String(diff) }));
                }}
                placeholder="Enter actual lbs count"
              />
              {adjustForm.actual_weight !== '' && adjustForm.lbs_adjusted !== '' && (
                <p className={`text-xs mt-1 ${parseFloat(adjustForm.lbs_adjusted) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  Adjustment: {parseFloat(adjustForm.lbs_adjusted) >= 0 ? '+' : ''}{adjustForm.lbs_adjusted} lbs
                </p>
              )}
            </div>
            <div>
              <Label>Or enter adjustment directly (lbs)</Label>
              <Input
                type="number"
                value={adjustForm.lbs_adjusted}
                onChange={e => setAdjustForm(f => ({ ...f, lbs_adjusted: e.target.value, actual_weight: '' }))}
                placeholder="+50 or -20"
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={adjustForm.reason} onChange={e=>setAdjustForm(f=>({...f,reason:e.target.value}))} placeholder="Physical count, transfer, etc." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialog(null)}>Cancel</Button>
            <Button onClick={handleAdjust}>Save Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Lot Dialog */}
      <Dialog open={!!editLotDialog} onOpenChange={() => setEditLotDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Inventory Lot</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Coffee</Label>
              <Select value={editLotDialog?.green_coffee_id || ''} onValueChange={v => setEditLotDialog(f => ({ ...f, green_coffee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select coffee" /></SelectTrigger>
                <SelectContent>{coffees.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Number of Bags</Label>
                <Input type="number" value={editLotDialog?.number_of_bags ?? ''} onChange={e => setEditLotDialog(f => ({ ...f, number_of_bags: e.target.value }))} />
              </div>
              <div>
                <Label>Bag Size</Label>
                <Select value={String(editLotDialog?.bag_size_kg || '')} onValueChange={v => setEditLotDialog(f => ({ ...f, bag_size_kg: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                  <SelectContent>
                    {BAG_SIZES.map(s => <SelectItem key={s.kg} value={String(s.kg)}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editLotDialog?.bag_size_kg === 'custom' && (
              <div>
                <Label>Custom Bag Size (kg)</Label>
                <Input type="number" step="0.1" value={editLotDialog?.custom_bag_size_kg || ''} onChange={e => setEditLotDialog(f => ({ ...f, custom_bag_size_kg: e.target.value }))} placeholder="e.g. 45" />
              </div>
            )}
            {editLotDialog?.number_of_bags && editLotDialog?.bag_size_kg && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Calculated: <span className="font-semibold text-foreground">
                  {formatLbs(calcLbsFromBags(editLotDialog.number_of_bags, editLotDialog.bag_size_kg, editLotDialog.custom_bag_size_kg))}
                </span> on hand
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Green $/lb</Label><Input type="number" step="0.01" value={editLotDialog?.green_cost_per_lb ?? ''} onChange={e => setEditLotDialog(f => ({ ...f, green_cost_per_lb: e.target.value }))} /></div>
              <div><Label>Landed $/lb</Label><Input type="number" step="0.01" value={editLotDialog?.landed_cost_per_lb ?? ''} onChange={e => setEditLotDialog(f => ({ ...f, landed_cost_per_lb: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Warehoused (lbs)</Label><Input type="number" value={editLotDialog?.lbs_warehoused ?? ''} onChange={e => setEditLotDialog(f => ({ ...f, lbs_warehoused: e.target.value }))} /></div>
              <div><Label>Arrival Date</Label><Input type="date" value={editLotDialog?.arrival_date || ''} onChange={e => setEditLotDialog(f => ({ ...f, arrival_date: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Warehouse Location</Label>
              <Select value={editLotDialog?.warehouse_location_id || ''} onValueChange={v => setEditLotDialog(f => ({ ...f, warehouse_location_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select warehouse (optional)" /></SelectTrigger>
                <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={editLotDialog?.notes || ''} onChange={e => setEditLotDialog(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLotDialog(null)}>Cancel</Button>
            <Button onClick={handleEditLot}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Lot Dialog */}
      <Dialog open={addLotDialog} onOpenChange={setAddLotDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Inventory Lot</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Coffee</Label>
              <Select value={newLot.green_coffee_id} onValueChange={v=>setNewLot(f=>({...f,green_coffee_id:v}))}>
                <SelectTrigger><SelectValue placeholder="Select coffee" /></SelectTrigger>
                <SelectContent>{coffees.map(c=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Number of Bags</Label>
                <Input type="number" value={newLot.number_of_bags} onChange={e=>setNewLot(f=>({...f,number_of_bags:e.target.value}))} />
              </div>
              <div>
                <Label>Bag Size</Label>
                <Select value={newLot.bag_size_kg} onValueChange={v=>setNewLot(f=>({...f,bag_size_kg:v}))}>
                  <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                  <SelectContent>
                    {BAG_SIZES.map(s=><SelectItem key={s.kg} value={String(s.kg)}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {newLot.bag_size_kg === 'custom' && (
              <div>
                <Label>Custom Bag Size (kg)</Label>
                <Input type="number" step="0.1" value={newLot.custom_bag_size_kg} onChange={e=>setNewLot(f=>({...f,custom_bag_size_kg:e.target.value}))} placeholder="e.g. 45" />
              </div>
            )}
            {newLot.number_of_bags && newLot.bag_size_kg && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Total: <span className="font-semibold text-foreground">
                  {formatLbs(calcLbsFromBags(newLot.number_of_bags, newLot.bag_size_kg, newLot.custom_bag_size_kg))}
                </span> — will be stored as <em>{warehouses.find(w => w.id === newLot.warehouse_location_id)?.location_type === 'off_site' ? 'Warehoused' : 'On Hand'}</em>
              </div>
            )}
            <div>
              <Label>Green $/lb</Label>
              <Input type="number" step="0.01" value={newLot.green_cost_per_lb} onChange={e=>setNewLot(f=>({...f,green_cost_per_lb:e.target.value}))} />
            </div>
            <div>
              <Label>Warehouse Location</Label>
              <Select value={newLot.warehouse_location_id} onValueChange={v=>setNewLot(f=>({...f,warehouse_location_id:v}))}>
                <SelectTrigger><SelectValue placeholder="Select warehouse (optional)" /></SelectTrigger>
                <SelectContent>{warehouses.map(w=><SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setAddLotDialog(false)}>Cancel</Button>
            <Button onClick={handleAddLot} disabled={!newLot.green_coffee_id}>Add Lot</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}