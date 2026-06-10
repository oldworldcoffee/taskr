import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import InventoryItemSearch from '@/components/inventory/InventoryItemSearch';
import { applyPoolPurchaseOption, poolUnitCost } from '@/lib/prepaidPools';
import { toast } from 'sonner';

const EMPTY_FORM = {
  item_id: '',
  label: '',
  vendor_id: '',
  vendor_name: '',
  total_quantity: '',
  total_cost: '',
  purchased_date: '',
  notes: '',
  source_invoice_id: null,
};

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export default function CreatePoolDialog({ open, onClose, items, vendors, initial, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [setItemCost, setSetItemCost] = useState(false);
  const [saving, setSaving] = useState(false);

  const item = items.find((i) => i.id === form.item_id);
  const unitCost = poolUnitCost(parseFloat(form.total_cost), parseFloat(form.total_quantity));

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_FORM, ...(initial || {}) });
    setSetItemCost(true);
  }, [open]);

  const handleItemChange = (itemId) => {
    setForm((f) => ({ ...f, item_id: itemId }));
  };

  const handleVendorChange = (vendorId) => {
    const vendor = vendors.find((v) => v.id === vendorId);
    setForm((f) => ({ ...f, vendor_id: vendorId, vendor_name: vendor?.name || f.vendor_name || '' }));
  };

  const save = async () => {
    const totalQuantity = parseFloat(form.total_quantity);
    const totalCost = parseFloat(form.total_cost);
    if (!form.item_id) { toast.error('Choose a catalog item for this pool.'); return; }
    if (!totalQuantity || totalQuantity <= 0) { toast.error('Total quantity must be greater than zero.'); return; }
    if (!Number.isFinite(totalCost) || totalCost < 0) { toast.error('Enter the total cost of the purchase.'); return; }

    setSaving(true);
    try {
      const pool = await base44.entities.PrepaidPool.create({
        item_id: form.item_id,
        vendor_id: form.vendor_id || null,
        vendor_name: String(form.vendor_name || '').trim(),
        source_invoice_id: form.source_invoice_id || null,
        label: String(form.label || '').trim(),
        total_quantity: totalQuantity,
        unit_of_measure: item?.unit_of_measure || 'EA',
        total_cost: totalCost,
        unit_cost: poolUnitCost(totalCost, totalQuantity),
        status: 'active',
        purchased_date: form.purchased_date || null,
        notes: String(form.notes || '').trim(),
      });

      let updatedItem = null;
      if (setItemCost && item) {
        try {
          updatedItem = await base44.entities.InventoryItem.update(item.id, {
            unit_cost: poolUnitCost(totalCost, totalQuantity),
            purchase_options: applyPoolPurchaseOption(item, pool),
          });
        } catch (error) {
          console.error('Failed to set item cost from pool:', error);
          toast.warning('Pool created, but the item cost could not be updated.');
        }
      }

      toast.success('Prepaid pool created');
      onCreated?.(pool, updatedItem);
      onClose();
    } catch (error) {
      toast.error(error.message || 'Failed to create pool');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Prepaid Pool</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            A prepaid pool tracks bulk stock you already paid for that the vendor still holds.
            It is not added to any location&apos;s on-hand stock — $0 drop-off invoices draw it down at the locked unit cost.
          </p>
          <div>
            <Label>Catalog Item *</Label>
            <div className="mt-1">
              <InventoryItemSearch value={form.item_id} onChange={handleItemChange} items={items} />
            </div>
          </div>
          <div>
            <Label>Label</Label>
            <Input
              className="mt-1"
              placeholder="e.g. 50k cups — June 2026"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div>
            <Label>Vendor</Label>
            <select
              className="mt-1 w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
              value={form.vendor_id || ''}
              onChange={(e) => handleVendorChange(e.target.value)}
            >
              <option value="">No vendor</option>
              {vendors.filter((v) => v.is_active !== false).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Total Quantity ({item?.unit_of_measure || 'EA'}) *</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                placeholder="50000"
                value={form.total_quantity}
                onChange={(e) => setForm((f) => ({ ...f, total_quantity: e.target.value }))}
              />
            </div>
            <div>
              <Label>Total Cost *</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="0.01"
                placeholder="5000.00"
                value={form.total_cost}
                onChange={(e) => setForm((f) => ({ ...f, total_cost: e.target.value }))}
              />
            </div>
          </div>
          {unitCost > 0 && (
            <p className="text-sm text-muted-foreground">
              Locked unit cost: <span className="font-medium text-foreground">{money(unitCost)}</span> per {item?.unit_of_measure || 'EA'}
            </p>
          )}
          <div>
            <Label>Purchased Date</Label>
            <Input
              className="mt-1"
              type="date"
              value={form.purchased_date || ''}
              onChange={(e) => setForm((f) => ({ ...f, purchased_date: e.target.value }))}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              className="mt-1 h-16"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <label className="flex items-start gap-2 cursor-pointer text-sm pt-2 border-t border-border">
            <input
              type="checkbox"
              className="h-4 w-4 mt-0.5 rounded border-gray-300 accent-primary"
              checked={setItemCost}
              onChange={(e) => setSetItemCost(e.target.checked)}
            />
            <span>
              <span className="font-medium">Use pool cost for item costing</span>
              <span className="block text-xs text-muted-foreground">
                Adds the pool as the item&apos;s preferred purchase option (locked cost) so recipes and inventory value use it while the pool is active.
                Other vendor options are kept for ordering. The journal numbers always use the locked cost either way.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter className="pt-2 border-t border-border mt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Creating...' : 'Create Pool'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
