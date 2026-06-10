import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const asArray = (value) => Array.isArray(value) ? value : [];
const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export default function SmartFillDialog({ open, onOpenChange, locationId, onConfirm }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const calculateSmartPars = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await base44.functions.invoke('calculateSmartParsAfterCount', {
        location_id: locationId
      });
      
      if (response.data && response.data.success) {
        setResults(response.data);
      } else {
        setError('Failed to calculate smart pars');
      }
    } catch (err) {
      setError(err.message || 'Failed to calculate');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (open && locationId) {
      calculateSmartPars();
    }
  }, [open]);

  const resultRows = asArray(results?.results);
  const updatedRows = resultRows.filter(r => r.status === 'updated');
  const noHistoryCount = resultRows.filter(r => r.status === 'no_history').length;
  const itemsUpdated = asNumber(results?.items_updated);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Calculate Smart Par Levels
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Analyzing order history and calculating optimal par levels...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-700">Error</p>
                  <p className="text-xs text-red-600 mt-1">{error}</p>
                </div>
              </div>
            </div>
          ) : !results ? (
            <div className="text-center text-muted-foreground py-8">
              <p>Select a location to calculate smart par levels</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Items Processed</span>
                  <span className="text-lg font-bold">{asNumber(results.items_processed)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-medium">Items Updated</span>
                  <span className="text-lg font-bold text-green-600">{itemsUpdated}</span>
                </div>
              </div>

              {results.warning && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800">{results.warning}</p>
                </div>
              )}

              {noHistoryCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800">
                    <strong>Note:</strong> {noHistoryCount} items have no order history and require manual par settings.
                  </p>
                </div>
              )}

              <div className="max-h-60 overflow-y-auto space-y-2">
                {updatedRows.slice(0, 10).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0">
                    <span className="font-medium truncate flex-1">{item.item_name}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">Par: <strong className="text-foreground">{item.suggested_par}</strong></span>
                      <span className="text-muted-foreground">Min: <strong className="text-foreground">{item.minimum_reorder_volume}</strong></span>
                    </div>
                  </div>
                ))}
                {updatedRows.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    +{updatedRows.length - 10} more items updated
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {itemsUpdated > 0 && (
            <Button onClick={() => { onConfirm(results); onOpenChange(false); }}>
              Use Smart Pars for Fill
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
