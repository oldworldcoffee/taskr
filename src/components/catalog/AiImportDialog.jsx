import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, AlertTriangle, PlusCircle, CopyX, HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STYLES = {
  new: { icon: PlusCircle, badge: 'bg-emerald-500/10 text-emerald-600', label: 'New' },
  duplicate: { icon: CopyX, badge: 'bg-amber-500/10 text-amber-600', label: 'Duplicate' },
  possible_duplicate: { icon: HelpCircle, badge: 'bg-primary/10 text-primary', label: 'Possible duplicate' },
};

const FIELD_LABELS = {
  item_name: 'Item Name', sku: 'SKU', category: 'Category', unit_of_measure: 'Unit of Measure',
  unit_cost: 'Unit Cost', description: 'Description', is_commissary_item: 'Commissary Item',
  commissary_price: 'Commissary Price', is_active: 'Active', vendor_name: 'Vendor',
  vendor_email: 'Vendor Email', product_name: 'Product Name', product_code: 'Product Code',
  pack_size: 'Pack Size', inner_pack_units: 'Inner Pack Units', inner_pack_name: 'Inner Pack Name',
  packs_per_case: 'Packs Per Case',
};

async function fileToCsvText(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer());
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(sheet);
  }
  return file.text();
}

export default function AiImportDialog({ open, onOpenChange, file, onImported }) {
  const [phase, setPhase] = useState('analyzing'); // analyzing | preview | importing | error
  const [prep, setPrep] = useState(null);
  const [error, setError] = useState('');
  const [actions, setActions] = useState({});
  const [mappingOpen, setMappingOpen] = useState(false);

  const analyze = async () => {
    setPhase('analyzing');
    setError('');
    setPrep(null);
    setActions({});
    try {
      const csvText = await fileToCsvText(file);
      const { data } = await base44.functions.invoke('aiPrepareCatalogImport', { csv_text: csvText, file_name: file.name });
      setPrep(data);
      setActions(Object.fromEntries((data.items || []).map((item, idx) => [idx, item.default_action])));
      setPhase('preview');
    } catch (err) {
      setError(err.message || 'Could not analyze the file');
      setPhase('error');
    }
  };

  useEffect(() => {
    if (open && file) analyze();
  }, [open, file]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = prep?.items || [];
  const counts = useMemo(() => {
    let create = 0, merge = 0, skip = 0;
    items.forEach((_, idx) => {
      const action = actions[idx] || 'skip';
      if (action === 'create') create += 1;
      else if (action === 'merge') merge += 1;
      else skip += 1;
    });
    return { create, merge, skip };
  }, [items, actions]);

  const mappedFields = useMemo(
    () => Object.entries(prep?.column_map || {}).filter(([, column]) => column),
    [prep]
  );

  const runImport = async () => {
    setPhase('importing');
    try {
      const { data } = await base44.functions.invoke('aiCommitCatalogImport', {
        items: items.map((item, idx) => ({ action: actions[idx] || 'skip', item })),
      });
      const r = data.results || {};
      toast.success(`Import complete — ${r.created || 0} added, ${r.merged || 0} merged, ${r.skipped || 0} skipped${r.vendors_created ? `, ${r.vendors_created} vendors created` : ''}`);
      if (r.errors?.length) {
        toast.warning(`${r.errors.length} item${r.errors.length === 1 ? '' : 's'} failed: ${r.errors[0]}${r.errors.length > 1 ? ' …' : ''}`, { duration: 12000 });
      }
      onImported?.();
      onOpenChange(false);
    } catch (err) {
      toast.error('Import failed: ' + err.message);
      setPhase('preview');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (phase !== 'importing') onOpenChange(next); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />AI Catalog Import
          </DialogTitle>
          <DialogDescription>
            {file ? `Reading "${file.name}" — ` : ''}the AI lines up the columns, translates units, and checks for duplicates against your current inventory before anything is imported.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {phase === 'analyzing' ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Analyzing your file...</p>
              <p className="text-xs text-muted-foreground">Mapping columns and comparing against your catalog. Nothing is imported yet.</p>
            </div>
          ) : phase === 'error' ? (
            <div className="py-8 text-center">
              <p className="text-sm text-destructive mb-3">{error}</p>
              <Button variant="outline" onClick={analyze}>Try Again</Button>
            </div>
          ) : prep ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Found {items.length} item{items.length === 1 ? '' : 's'} in {prep.rows_total} rows
                — {prep.stats.new} new, {prep.stats.duplicates} duplicate{prep.stats.duplicates === 1 ? '' : 's'}, {prep.stats.possible_duplicates} possible duplicate{prep.stats.possible_duplicates === 1 ? '' : 's'}.
                {prep.rows_skipped > 0 && ` ${prep.rows_skipped} row${prep.rows_skipped === 1 ? '' : 's'} had no item name and were ignored.`}
                {' '}Duplicates are skipped unless you choose otherwise.
              </p>

              <button
                type="button"
                onClick={() => setMappingOpen(!mappingOpen)}
                className="flex items-center gap-1 text-sm text-primary hover:opacity-80"
              >
                {mappingOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                How the columns were matched
              </button>
              {mappingOpen && (
                <div className="border border-border rounded-lg p-3 text-xs space-y-1 bg-muted/30">
                  {mappedFields.map(([field, column]) => (
                    <p key={field}><span className="font-medium">{FIELD_LABELS[field] || field}</span> ← "{column}"</p>
                  ))}
                  {prep.unmapped_columns?.length > 0 && (
                    <p className="text-muted-foreground pt-1">Ignored columns: {prep.unmapped_columns.join(', ')}</p>
                  )}
                </div>
              )}

              <div className="border border-border rounded-lg divide-y divide-border">
                {items.map((item, idx) => {
                  const style = STATUS_STYLES[item.status] || STATUS_STYLES.new;
                  const Icon = style.icon;
                  return (
                    <div key={idx} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 shrink-0 ${style.badge}`}>
                              <Icon className="w-3 h-3" />{style.label}
                            </span>
                            <p className="text-sm font-medium truncate">{item.name}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.category || 'No category'} · {item.unit_of_measure} · {item.purchase_options.length} purchase option{item.purchase_options.length === 1 ? '' : 's'}
                            {item.match_item_name && item.match_item_name !== item.name && ` · matches "${item.match_item_name}"`}
                          </p>
                          {item.warnings.map((warning, wIdx) => (
                            <p key={wIdx} className="text-xs text-amber-600 mt-0.5 flex items-start gap-1">
                              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{warning}
                            </p>
                          ))}
                        </div>
                        <Select value={actions[idx] || 'skip'} onValueChange={(value) => setActions(prev => ({ ...prev, [idx]: value }))}>
                          <SelectTrigger className="h-8 w-40 text-sm shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="create">Add as new</SelectItem>
                            {item.match_item_id && <SelectItem value="merge">Merge options</SelectItem>}
                            <SelectItem value="skip">Skip</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={phase === 'importing'}>Cancel</Button>
          {(phase === 'preview' || phase === 'importing') && (
            <Button onClick={runImport} disabled={phase === 'importing' || counts.create + counts.merge === 0}>
              {phase === 'importing'
                ? 'Importing...'
                : `Import (${counts.create} new${counts.merge ? `, ${counts.merge} merge` : ''})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
