import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Download, Upload, Database, CheckCircle2, AlertCircle, Loader2, FileJson, Trash2 } from "lucide-react";

function SummaryRow({ label, count }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground capitalize">{label.replace(/([A-Z])/g, ' $1').trim()}</span>
      <Badge variant="secondary">{count}</Badge>
    </div>
  );
}

function ImportResultRow({ label, result }) {
  if (result?.skipped && result.success === 0) return null;
  const failed = result?.failed || 0;
  const success = result?.success || 0;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground capitalize">{label.replace(/([A-Z])/g, ' $1').trim()}</span>
      <div className="flex gap-2">
        {success > 0 && <Badge className="bg-green-100 text-green-700 border-green-200">{success} imported</Badge>}
        {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
      </div>
    </div>
  );
}

export default function DataMigration() {
  const [exporting, setExporting] = useState(false);
  const [exportSummary, setExportSummary] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingImportData, setPendingImportData] = useState(null);
  const fileInputRef = useRef(null);

  const handleExport = async () => {
    setExporting(true);
    setExportSummary(null);
    const res = await base44.functions.invoke('exportAppData', {});
    const exportData = res.data;
    setExportSummary(exportData.summary);

    // Download as JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `app-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportResult(null);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = JSON.parse(ev.target.result);
      setPendingImportData(parsed);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImport = () => {
    if (!pendingImportData) return;
    if (clearExisting) {
      setConfirmClear(true);
    } else {
      runImport(false);
    }
  };

  const runImport = async (clear) => {
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    setConfirmClear(false);

    try {
      const payload = pendingImportData?.data ? pendingImportData : { data: pendingImportData };

      const res = await base44.functions.invoke('importAppData', {
        data: payload.data,
        options: { clearExisting: clear },
      });

      if (res.data?.success) {
        setImportResult(res.data);
        setPendingImportData(null);
      } else {
        setImportError(res.data?.error || "Import failed");
      }
    } catch (error) {
      setImportError(error.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Data Migration</h1>
        <p className="text-muted-foreground mt-1">Export all app data or import a previously exported snapshot into this instance.</p>
      </div>

      {/* Export */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <Download className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle>Export Data</CardTitle>
              <CardDescription>Download a full JSON snapshot of all companies, locations, users, checklists, knowledge base, forum, equipment, and more.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleExport} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? "Exporting..." : "Export All Data"}
          </Button>

          {exportSummary && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-semibold text-green-700">Export complete — file downloaded</span>
              </div>
              <div className="divide-y divide-green-100">
                {Object.entries(exportSummary).map(([key, count]) => (
                  <SummaryRow key={key} label={key} count={count} />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50">
              <Upload className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle>Import Data</CardTitle>
              <CardDescription>Upload a previously exported JSON file to import data into this instance. IDs are remapped automatically.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <strong>Note:</strong> Users cannot be imported — they must be invited manually in the target app. All other entity relationships (foreign keys) are remapped automatically.
          </div>

          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <FileJson className="h-4 w-4" />
              Select Export File
            </Button>
            {pendingImportData && (
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                File loaded — exported {pendingImportData.exported_at?.slice(0, 10) || "unknown date"}
              </span>
            )}
          </div>

          {/* Clear existing option */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={e => setClearExisting(e.target.checked)}
              className="rounded border-border"
            />
            <div>
              <span className="text-sm font-medium">Clear existing data before import</span>
              <p className="text-xs text-muted-foreground">Deletes all existing records before inserting the imported data. Use with caution.</p>
            </div>
          </label>

          <Button
            onClick={handleImport}
            disabled={!pendingImportData || importing}
            className="gap-2"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            {importing ? "Importing..." : "Run Import"}
          </Button>

          {importError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {importError}
            </div>
          )}

          {importResult && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-semibold text-green-700">Import complete</span>
              </div>
              <p className="text-xs text-green-600 mb-3">
                {importResult.summary.totalSuccess} records imported, {importResult.summary.totalFailed} failed
              </p>
              <div className="divide-y divide-green-100">
                {Object.entries(importResult.details).map(([key, result]) => (
                  <ImportResultRow key={key} label={key} result={result} />
                ))}
              </div>
              {importResult.note && (
                <p className="text-xs text-amber-700 mt-3 pt-3 border-t border-green-200">{importResult.note}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm clear dialog */}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Clear all existing data?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete ALL existing records in this instance before importing. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => runImport(true)}
            >
              Yes, clear and import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
