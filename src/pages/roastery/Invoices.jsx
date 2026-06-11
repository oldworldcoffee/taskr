import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { recalculateRoasterySnapshots } from '@/lib/roasteryLedger';
import { useCompany } from '@/components/roastery/RoasteryContext';
import PageHeader from '@/components/roastery/PageHeader';
import StatusBadge from '@/components/roastery/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, XCircle, Eye, Loader2, Truck, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function Invoices() {
  const { companyId, currentUser, isManager } = useCompany();
  const [invoices, setInvoices] = useState([]);
  const [coffees, setCoffees] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reviewDialog, setReviewDialog] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [receiveDialog, setReceiveDialog] = useState(null); // { inv }
  const [receiveDate, setReceiveDate] = useState('');

  useEffect(() => { if (companyId) loadData(); }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const [invData, coffeeData, whData] = await Promise.all([
      roastery.entities.Invoice.filter({ company_id: companyId }, '-created_date'),
      roastery.entities.GreenCoffee.filter({ company_id: companyId, is_active: true }),
      roastery.entities.WarehouseLocation.filter({ company_id: companyId }),
    ]);
    setInvoices(invData);
    setCoffees(coffeeData);
    setWarehouses(whData);
    setLoading(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await roastery.integrations.Core.UploadFile({ file });
    const invoice = await roastery.entities.Invoice.create({
      company_id: companyId,
      file_url,
      file_name: file.name,
      status: 'processing',
      uploaded_by_id: currentUser?.id,
    });

    // Reset upload button immediately and show the new row
    setUploading(false);
    setProcessing(true);
    toast.info('Invoice uploaded! AI is now analyzing it — this takes about 30 seconds...');
    loadData();

    try {
      const { data: result } = await roastery.functions.invoke('roasteryExtractInvoice', {
        file_url,
        file_name: file.name,
      });

      await roastery.entities.Invoice.update(invoice.id, {
        status: 'pending_review',
        supplier_name: result.supplier_name,
        invoice_number: result.invoice_number,
        invoice_date: result.invoice_date,
        total_amount: result.total_amount,
        freight_total: result.freight_total || 0,
        tariff_total: result.tariff_total || 0,
        storage_fee_total: result.storage_fee_total || 0,
        line_items: result.line_items || [],
        ai_confidence: result.confidence,
        ai_notes: result.notes,
      });
      toast.success('Invoice analyzed and ready for review!');
    } catch (err) {
      await roastery.entities.Invoice.update(invoice.id, {
        status: 'pending_review',
        ai_confidence: 0,
        ai_notes: `AI parsing failed (${err.message || 'unknown error'}). Enter the invoice details manually.`,
      }).catch(() => {});
      toast.error('AI could not parse the invoice — review it and enter details manually.');
    }

    setProcessing(false);
    loadData();
  };

  // Step 1: Approve → in_transit
  // Creates lot records with lbs_on_hand=0 (coffee is in transit, not yet at roastery)
  const handleApprove = async () => {
    const inv = reviewDialog;
    const totalLbs = (inv.line_items || []).reduce((s, li) => s + (li.total_lbs || 0), 0);
    const today = new Date().toISOString().split('T')[0];

    const hasPerLineTariff = (inv.line_items || []).some(li => li.tariff_cost > 0);
    const hasPerLineStorage = (inv.line_items || []).some(li => li.storage_fee > 0);

    const updatedLineItems = [...(inv.line_items || [])];

    for (let i = 0; i < updatedLineItems.length; i++) {
      const li = updatedLineItems[i];
      const lbs = li.total_lbs || 0;
      const lbsFraction = totalLbs > 0 ? lbs / totalLbs : 0;
      const lineTariff = hasPerLineTariff ? (li.tariff_cost || 0) : (inv.tariff_total || 0) * lbsFraction;
      const lineStorage = hasPerLineStorage ? (li.storage_fee || 0) : (inv.storage_fee_total || 0) * lbsFraction;
      const lineFreight = (inv.freight_total || 0) * lbsFraction;
      const landedCostPerLb = lbs > 0
        ? (li.cost_per_lb || 0) + (lineFreight + lineTariff + lineStorage) / lbs
        : li.cost_per_lb || 0;

      // Create lot with lbs_on_hand=0 — coffee is in transit
      const lot = await roastery.entities.InventoryLot.create({
        company_id: companyId,
        green_coffee_id: li.matched_green_coffee_id || null,
        invoice_id: inv.id,
        total_lbs_received: lbs,
        lbs_on_hand: 0,
        lbs_warehoused: 0,
        number_of_bags: li.number_of_bags,
        green_cost_per_lb: li.cost_per_lb,
        freight_cost_total: lineFreight,
        tariff_cost_total: lineTariff,
        storage_fee_total: lineStorage,
        landed_cost_per_lb: landedCostPerLb,
        arrival_date: inv.invoice_date,
        is_active: true,
        notes: 'In transit — awaiting physical receipt',
      });

      // Store the lot id back on the line item so we can update it on receipt
      updatedLineItems[i] = { ...li, inventory_lot_id: lot.id };
    }

    await roastery.entities.Invoice.update(inv.id, {
      status: 'in_transit',
      approved_by_id: currentUser?.id,
      approved_date: today,
      line_items: updatedLineItems,
    });

    toast.success('Invoice approved — coffee marked as in transit');
    setReviewDialog(null);
    loadData();
  };

  const openReceiveDialog = (inv) => {
    setReceiveDate(new Date().toISOString().split('T')[0]);
    setReceiveDialog({ inv });
  };

  // Step 2: Receive → approved
  // Updates lots to add lbs_on_hand (coffee physically arrived at roastery)
  const handleReceive = async (inv) => {
    const today = receiveDate || new Date().toISOString().split('T')[0];
    const affectedLotIds = [];

    for (const li of (inv.line_items || [])) {
      const lbs = li.total_lbs || 0;
      if (!li.inventory_lot_id) continue;

      const lot = await roastery.entities.InventoryLot.filter({ company_id: companyId }).then(
        lots => lots.find(l => l.id === li.inventory_lot_id)
      );
      if (!lot) continue;

      const oldOnHand = lot.lbs_on_hand || 0;
      const oldWarehoused = lot.lbs_warehoused || 0;
      await roastery.entities.InventoryLot.update(li.inventory_lot_id, {
        lbs_on_hand: lbs,
        lbs_warehoused: 0,
        notes: '',
      });
      // Ledger movements (received date drives roastery history). The lot cache
      // is set above; these record the signed deltas.
      const movementBase = {
        company_id: companyId,
        inventory_lot_id: lot.id,
        green_coffee_id: lot.green_coffee_id || null,
        warehouse_location_id: lot.warehouse_location_id || null,
        movement_date: today,
        green_cost_per_lb: parseFloat(lot.green_cost_per_lb) || 0,
        landed_cost_per_lb: parseFloat(lot.landed_cost_per_lb || lot.green_cost_per_lb) || 0,
        source_type: 'receipt',
        source_id: inv.id,
      };
      if (lbs - oldOnHand !== 0) {
        await roastery.entities.InventoryMovement.create({ ...movementBase, bucket: 'on_hand', lbs_delta: lbs - oldOnHand });
      }
      if (oldWarehoused !== 0) {
        await roastery.entities.InventoryMovement.create({ ...movementBase, bucket: 'warehoused', lbs_delta: -oldWarehoused });
      }
      affectedLotIds.push(lot.id);
    }

    await roastery.entities.Invoice.update(inv.id, {
      status: 'approved',
      received_by_id: currentUser?.id,
      received_date: today,
    });

    // Backdated receiving: recompute roastery snapshots from the received date.
    const realToday = new Date().toISOString().split('T')[0];
    if (today < realToday && affectedLotIds.length) {
      try {
        await recalculateRoasterySnapshots({ companyId, fromDate: today, lotIds: affectedLotIds, reason: 'backdated_roastery_receipt', sourceId: inv.id });
      } catch (error) {
        console.error('Roastery snapshot recalc failed:', error);
      }
    }

    toast.success('Coffee received — inventory updated!');
    setReceiveDialog(null);
    loadData();
  };

  const handleReject = async (reason) => {
    await roastery.entities.Invoice.update(reviewDialog.id, { status: 'rejected', rejection_reason: reason });
    toast.info('Invoice rejected');
    setReviewDialog(null);
    loadData();
  };

  const updateLineItem = (idx, field, value) => {
    setReviewDialog(prev => {
      const items = [...(prev.line_items || [])];
      items[idx] = { ...items[idx], [field]: value };
      return { ...prev, line_items: items };
    });
  };

  const statusColor = { processing: 'text-blue-600', pending_review: 'text-yellow-700', in_transit: 'text-orange-600', approved: 'text-green-700', rejected: 'text-red-600' };

  if (loading) return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-8">
      <PageHeader title="Invoices" description="Upload and process green coffee invoices">
        <label className="cursor-pointer">
          <Button asChild className="gap-2" disabled={uploading}>
            <span>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading...' : 'Upload Invoice'}
            </span>
          </Button>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Invoice</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Supplier</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Date</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Total</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-muted/30">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{inv.invoice_number || inv.file_name || 'Invoice'}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">{inv.supplier_name || '—'}</td>
                  <td className="py-3 px-4 text-muted-foreground">{inv.invoice_date || '—'}</td>
                  <td className="py-3 px-4 text-right">{inv.total_amount ? `$${inv.total_amount.toFixed(2)}` : '—'}</td>
                  <td className="py-3 px-4"><StatusBadge status={inv.status} /></td>
                  <td className="py-3 px-4">
                   {isManager && inv.status === 'pending_review' && (
                     <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setReviewDialog({ ...inv })}>
                       <Eye className="w-3 h-3" /> Review
                     </Button>
                   )}
                   {isManager && inv.status === 'in_transit' && (
                     <Button variant="outline" size="sm" className="gap-1 text-xs text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => openReceiveDialog(inv)}>
                       <PackageCheck className="w-3 h-3" /> Mark Received
                     </Button>
                   )}
                   {(inv.status === 'approved' || inv.status === 'rejected' || inv.status === 'in_transit') && (
                     <Button variant="ghost" size="sm" className="gap-1 text-xs ml-1" onClick={() => setReviewDialog({ ...inv, readOnly: true })}>
                       <Eye className="w-3 h-3" /> View
                     </Button>
                   )}
                   {inv.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No invoices yet. Upload your first invoice.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Receive Date Dialog */}
      <Dialog open={!!receiveDialog} onOpenChange={() => setReceiveDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">When was this coffee physically received at the roastery?</p>
            <div>
              <Label>Received Date</Label>
              <Input type="date" value={receiveDate} max={new Date().toISOString().split('T')[0]} onChange={e => setReceiveDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveDialog(null)}>Cancel</Button>
            <Button className="gap-1" onClick={() => handleReceive(receiveDialog.inv)} disabled={!receiveDate}>
              <PackageCheck className="w-4 h-4" /> Confirm Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={() => setReviewDialog(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {reviewDialog?.readOnly ? 'Invoice — ' : 'Review Invoice — '}
              {reviewDialog?.supplier_name || reviewDialog?.file_name}
              {reviewDialog?.readOnly && <StatusBadge status={reviewDialog?.status} className="ml-2" />}
            </DialogTitle>
          </DialogHeader>
          {reviewDialog && (
            <div className="space-y-6">
              {reviewDialog.ai_confidence && (
                <div className={`p-3 rounded-md text-sm ${reviewDialog.ai_confidence > 0.85 ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'}`}>
                  AI Confidence: {Math.round(reviewDialog.ai_confidence * 100)}% — {reviewDialog.ai_notes || 'Please verify all fields before approving.'}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div><Label>Supplier</Label><Input value={reviewDialog.supplier_name||''} onChange={e=>setReviewDialog(p=>({...p,supplier_name:e.target.value}))} disabled={reviewDialog.readOnly} /></div>
                <div><Label>Invoice #</Label><Input value={reviewDialog.invoice_number||''} onChange={e=>setReviewDialog(p=>({...p,invoice_number:e.target.value}))} disabled={reviewDialog.readOnly} /></div>
                <div><Label>Date</Label><Input type="date" value={reviewDialog.invoice_date||''} onChange={e=>setReviewDialog(p=>({...p,invoice_date:e.target.value}))} disabled={reviewDialog.readOnly} /></div>
                <div><Label>Total Amount ($)</Label><Input type="number" step="0.01" value={reviewDialog.total_amount||''} onChange={e=>setReviewDialog(p=>({...p,total_amount:parseFloat(e.target.value)}))} disabled={reviewDialog.readOnly} /></div>
                <div><Label>Freight ($)</Label><Input type="number" step="0.01" value={reviewDialog.freight_total||0} onChange={e=>setReviewDialog(p=>({...p,freight_total:parseFloat(e.target.value)}))} disabled={reviewDialog.readOnly} /></div>
                <div><Label>Tariffs ($)</Label><Input type="number" step="0.01" value={reviewDialog.tariff_total||0} onChange={e=>setReviewDialog(p=>({...p,tariff_total:parseFloat(e.target.value)}))} disabled={reviewDialog.readOnly} /></div>
                <div><Label>Storage Fees ($)</Label><Input type="number" step="0.01" value={reviewDialog.storage_fee_total||0} onChange={e=>setReviewDialog(p=>({...p,storage_fee_total:parseFloat(e.target.value)}))} disabled={reviewDialog.readOnly} /></div>
              </div>
              {reviewDialog.readOnly && reviewDialog.rejection_reason && (
                <div className="p-3 rounded-md bg-red-50 text-red-800 text-sm">
                  <span className="font-medium">Rejection reason:</span> {reviewDialog.rejection_reason}
                </div>
              )}

              <div>
                <h3 className="font-medium text-sm mb-3">Line Items</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium text-muted-foreground">Coffee Name</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Bags</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Lbs/Bag</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Total Lbs</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">$/lb (green)</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Tariff ($)</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Storage ($)</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Landed $/lb</th>
                        <th className="text-left py-2 font-medium text-muted-foreground">Match Coffee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reviewDialog.line_items || []).map((li, i) => {
                        const lbs = li.total_lbs || 0;
                        const lineTariff = li.tariff_cost || 0;
                        const lineStorage = li.storage_fee || 0;
                        const totalLbsAll = (reviewDialog.line_items || []).reduce((s, x) => s + (x.total_lbs || 0), 0);
                        const lbsFraction = totalLbsAll > 0 ? lbs / totalLbsAll : 0;
                        const lineFreight = (reviewDialog.freight_total || 0) * lbsFraction;
                        const landedPreview = lbs > 0
                          ? (li.cost_per_lb || 0) + (lineFreight + lineTariff + lineStorage) / lbs
                          : (li.cost_per_lb || 0);
                        return (
                        <tr key={i} className="border-b">
                          <td className="py-2 pr-2"><Input className="h-7 text-xs" value={li.coffee_name||''} onChange={e=>updateLineItem(i,'coffee_name',e.target.value)} disabled={reviewDialog.readOnly} /></td>
                          <td className="py-2 pr-2"><Input className="h-7 text-xs w-16" type="number" value={li.number_of_bags||''} onChange={e=>updateLineItem(i,'number_of_bags',parseFloat(e.target.value))} disabled={reviewDialog.readOnly} /></td>
                          <td className="py-2 pr-2"><Input className="h-7 text-xs w-16" type="number" value={li.lbs_per_bag||''} onChange={e=>updateLineItem(i,'lbs_per_bag',parseFloat(e.target.value))} disabled={reviewDialog.readOnly} /></td>
                          <td className="py-2 pr-2"><Input className="h-7 text-xs w-20" type="number" value={li.total_lbs||''} onChange={e=>updateLineItem(i,'total_lbs',parseFloat(e.target.value))} disabled={reviewDialog.readOnly} /></td>
                          <td className="py-2 pr-2"><Input className="h-7 text-xs w-20" type="number" step="0.01" value={li.cost_per_lb||''} onChange={e=>updateLineItem(i,'cost_per_lb',parseFloat(e.target.value))} disabled={reviewDialog.readOnly} /></td>
                          <td className="py-2 pr-2"><Input className="h-7 text-xs w-20" type="number" step="0.01" placeholder="0.00" value={li.tariff_cost||''} onChange={e=>updateLineItem(i,'tariff_cost',parseFloat(e.target.value)||0)} disabled={reviewDialog.readOnly} /></td>
                          <td className="py-2 pr-2"><Input className="h-7 text-xs w-20" type="number" step="0.01" placeholder="0.00" value={li.storage_fee||''} onChange={e=>updateLineItem(i,'storage_fee',parseFloat(e.target.value)||0)} disabled={reviewDialog.readOnly} /></td>
                          <td className="py-2 pr-2 text-right font-medium text-xs">${landedPreview.toFixed(4)}</td>
                          <td className="py-2 pr-2">
                            <Select value={li.matched_green_coffee_id||''} onValueChange={v=>updateLineItem(i,'matched_green_coffee_id',v)}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Match..." /></SelectTrigger>
                              <SelectContent>{coffees.map(c=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a href={reviewDialog.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View original file →</a>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewDialog(null)}>{reviewDialog?.readOnly ? 'Close' : 'Cancel'}</Button>
            {!reviewDialog?.readOnly && (
              <>
                <Button variant="destructive" className="gap-1" onClick={() => handleReject('Rejected by manager')}>
                  <XCircle className="w-4 h-4" /> Reject
                </Button>
                <Button className="gap-1" onClick={handleApprove}>
                  <Truck className="w-4 h-4" /> Approve — Mark In Transit
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}