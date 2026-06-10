import { useState } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import PageHeader from '@/components/roastery/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const ENTITIES = [
  { key: 'GreenCoffee', label: 'Green Coffees' },
  { key: 'InventoryLot', label: 'Inventory Lots' },
  { key: 'InventoryAdjustment', label: 'Inventory Adjustments' },
  { key: 'Invoice', label: 'Invoices' },
  { key: 'CategorySlot', label: 'Category Slots' },
  { key: 'CategoryRotation', label: 'Category Rotations' },
  { key: 'BlendComponentRotation', label: 'Blend Component Rotations' },
  { key: 'PricingRecord', label: 'Pricing Records' },
  { key: 'WarehouseLocation', label: 'Warehouse Locations' },
];

export default function DataTools() {
  const { companyId } = useCompany();
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);

  const handleExport = async () => {
    setExporting(true);
    setExportDone(false);
    const snapshot = { exported_at: new Date().toISOString(), company_id: companyId, data: {} };

    await Promise.all(
      ENTITIES.map(async ({ key }) => {
        const records = await roastery.entities[key].filter({ company_id: companyId });
        snapshot.data[key] = records;
      })
    );

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roastery-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
    setExportDone(true);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setImporting(true);
    setImportResult(null);
    setImportError(null);

    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);

      if (!snapshot.data) {
        setImportError('Invalid export file — missing data block.');
        return;
      }

      const results = {};

      for (const { key } of ENTITIES) {
        const records = snapshot.data[key];
        if (!records?.length) { results[key] = 0; continue; }

        // Keep original ids so cross-entity references (green_coffee_id,
        // category_slot_id, inventory_lot_id, ...) stay intact across
        // environments. Drop only Base44 metadata fields that have no column
        // in the Supabase schema.
        const toUpsert = records.map(
          ({ created_by, created_by_id, is_sample, ...rest }) => ({
            ...rest,
            company_id: companyId, // always bind to current company
          })
        );

        const upserted = await roastery.entities[key].upsert(toUpsert);
        results[key] = upserted.length;
      }

      setImportResult(results);
    } catch (err) {
      setImportError(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const totalExportCount = ENTITIES.length;

  return (
    <div className="p-8 max-w-3xl">
      <PageHeader
        title="Data Tools"
        description="Export all your data as a JSON backup, or import a previous export."
      />

      {/* Export */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            Export Data
          </CardTitle>
          <CardDescription>
            Downloads a full JSON snapshot of all {totalExportCount} data types for your company.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            {ENTITIES.map(({ label }) => (
              <Badge key={label} variant="secondary" className="text-xs">{label}</Badge>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? 'Exporting…' : 'Download Export'}
            </Button>
            {exportDone && (
              <span className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle className="w-4 h-4" /> Export downloaded successfully
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            Import Data
          </CardTitle>
          <CardDescription>
            Upload a previously exported JSON file. Records keep their original ids, so links between coffees, lots, rotations, and invoices are preserved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <strong>Note:</strong> Import merges into existing data. Records with the same id as one in the file are overwritten with the imported version; everything else is left untouched.
          </div>

          <label className="cursor-pointer">
            <input type="file" accept=".json" className="hidden" onChange={handleImport} disabled={importing} />
            <Button asChild disabled={importing} variant="outline">
              <span>
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {importing ? 'Importing…' : 'Choose Export File'}
              </span>
            </Button>
          </label>

          {importError && (
            <div className="mt-4 flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4" />
              {importError}
            </div>
          )}

          {importResult && (
            <div className="mt-4 p-4 rounded-md border bg-green-50 border-green-200">
              <div className="flex items-center gap-2 mb-3 text-green-700 font-medium text-sm">
                <CheckCircle className="w-4 h-4" />
                Import complete
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {ENTITIES.map(({ key, label }) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{importResult[key] ?? 0} records</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}