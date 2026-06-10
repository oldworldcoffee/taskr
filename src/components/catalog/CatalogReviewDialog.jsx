import { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, CheckCircle2, AlertTriangle, XCircle, Lightbulb, CheckSquare, Square, Pencil } from 'lucide-react';
import { toast } from 'sonner';

const SEVERITY_STYLES = {
  error: { icon: XCircle, badge: 'bg-destructive/10 text-destructive', label: 'Error' },
  warning: { icon: AlertTriangle, badge: 'bg-amber-500/10 text-amber-600', label: 'Warning' },
  suggestion: { icon: Lightbulb, badge: 'bg-primary/10 text-primary', label: 'Suggestion' },
};

const UOM_OPTIONS = ['EA', 'fl-oz', 'ml', 'L', 'Pt', 'Qt', 'gal', 'oz', 'lb', 'g', 'kg'];

// Issue types whose field can be corrected inline with a dropdown.
const FIELD_BY_TYPE = {
  missing_uom: 'unit_of_measure',
  invalid_uom: 'unit_of_measure',
  uom_suggestion: 'unit_of_measure',
  missing_category: 'category',
  category_suggestion: 'category',
};

const SKIP = '__skip__';

export default function CatalogReviewDialog({ open, onOpenChange, categories = [], onEditItem, onReviewingChange, onApplied }) {
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  // edits: issue idx -> chosen field value; checks: idx set for checkbox-style fixes
  const [edits, setEdits] = useState({});
  const [checks, setChecks] = useState(new Set());
  const [applying, setApplying] = useState(false);
  // Bumping the run id abandons the in-flight run; openRef lets the completion
  // handler know whether to toast (dialog closed) or just render (dialog open).
  const runIdRef = useRef(0);
  const openRef = useRef(open);

  useEffect(() => { openRef.current = open; }, [open]);

  const setReviewingState = (value) => {
    setReviewing(value);
    onReviewingChange?.(value);
  };

  const runReview = async () => {
    const runId = ++runIdRef.current;
    setReviewingState(true);
    setError('');
    setResult(null);
    setEdits({});
    setChecks(new Set());
    try {
      const { data } = await base44.functions.invoke('reviewCatalog', {});
      if (runId !== runIdRef.current) return;
      setResult(data);
      const nextEdits = {};
      const nextChecks = new Set();
      (data.issues || []).forEach((issue, idx) => {
        if (!issue.fix) return;
        if (FIELD_BY_TYPE[issue.type]) nextEdits[idx] = issue.fix.value;
        else nextChecks.add(idx);
      });
      setEdits(nextEdits);
      setChecks(nextChecks);
      if (!openRef.current) {
        const count = (data.issues || []).length;
        toast.success(`AI catalog review complete — ${count === 0 ? 'no issues found!' : `${count} issue${count === 1 ? '' : 's'} found`}`, {
          duration: 15000,
          action: { label: 'View Results', onClick: () => onOpenChange(true) },
        });
      }
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(err.message || 'Catalog review failed');
      if (!openRef.current) toast.error('AI catalog review failed: ' + (err.message || 'Unknown error'));
    } finally {
      if (runId === runIdRef.current) setReviewingState(false);
    }
  };

  const cancelReview = () => {
    runIdRef.current += 1;
    setReviewingState(false);
    onOpenChange(false);
  };

  useEffect(() => {
    // Start a review on open, but keep showing an in-flight or finished run.
    if (open && !reviewing && !result && !error) runReview();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = result?.issues || [];

  const itemGroups = useMemo(() => {
    const groups = new Map();
    issues.forEach((issue, idx) => {
      if (!groups.has(issue.item_id)) groups.set(issue.item_id, { itemId: issue.item_id, itemName: issue.item_name, entries: [] });
      groups.get(issue.item_id).entries.push({ ...issue, idx });
    });
    return [...groups.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [issues]);

  const categoryNames = useMemo(
    () => [...new Set(categories.map(c => c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [categories]
  );

  const optionsForField = (field) => field === 'unit_of_measure' ? UOM_OPTIONS : categoryNames;

  const changeCount = Object.values(edits).filter(v => v !== undefined).length + checks.size;

  const toggleCheck = (idx) => {
    setChecks(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const setEdit = (idx, value) => {
    setEdits(prev => {
      const next = { ...prev };
      if (value === SKIP) delete next[idx];
      else next[idx] = value;
      return next;
    });
  };

  const applyChanges = async () => {
    // Merge every chosen change per item so each item is updated once.
    const patches = new Map();
    const appliedIdx = new Set();
    issues.forEach((issue, idx) => {
      const field = FIELD_BY_TYPE[issue.type];
      if (field && edits[idx] !== undefined) {
        patches.set(issue.item_id, { ...(patches.get(issue.item_id) || {}), [field]: edits[idx] });
        appliedIdx.add(idx);
      } else if (issue.fix && checks.has(idx)) {
        patches.set(issue.item_id, { ...(patches.get(issue.item_id) || {}), [issue.fix.field]: issue.fix.value });
        appliedIdx.add(idx);
      }
    });
    if (!appliedIdx.size) return;

    setApplying(true);
    try {
      await Promise.all([...patches.entries()].map(([id, patch]) => base44.entities.InventoryItem.update(id, patch)));
      toast.success(`Applied ${appliedIdx.size} change${appliedIdx.size === 1 ? '' : 's'} to ${patches.size} item${patches.size === 1 ? '' : 's'}`);
      setResult(prev => ({ ...prev, issues: prev.issues.filter((_, idx) => !appliedIdx.has(idx)) }));
      setEdits({});
      setChecks(new Set());
      onApplied?.();
    } catch (err) {
      toast.error('Failed to apply changes: ' + err.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />AI Catalog Review
          </DialogTitle>
          <DialogDescription>
            Checks every active item for missing purchase options, unconfigured counting units, missing or mismatched units of measure, and other catalog problems.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {reviewing ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Reviewing your catalog...</p>
              <p className="text-xs text-muted-foreground">This can take a minute. Run it in the background and we'll notify you when it's ready.</p>
            </div>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-sm text-destructive mb-3">{error}</p>
              <Button variant="outline" onClick={runReview}>Try Again</Button>
            </div>
          ) : result && issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="font-medium">Your catalog looks clean!</p>
              <p className="text-sm text-muted-foreground">Reviewed {result.items_reviewed} items and found no issues.</p>
            </div>
          ) : result ? (
            <div className="space-y-4 py-2">
              {result.warning && (
                <p className="text-xs text-amber-600 bg-amber-500/10 rounded-md px-3 py-2">{result.warning}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Found {issues.length} issue{issues.length === 1 ? '' : 's'} across {itemGroups.length} of {result.items_reviewed} items.
                AI suggestions are pre-selected — adjust any dropdown, or use the pencil to edit an item directly.
              </p>
              {itemGroups.map(group => (
                <div key={group.itemId} className="border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-muted/50 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{group.itemName}</p>
                    {onEditItem && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="Edit item"
                        onClick={() => onEditItem(group.itemId)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="divide-y divide-border">
                    {group.entries.map(entry => {
                      const style = SEVERITY_STYLES[entry.severity] || SEVERITY_STYLES.warning;
                      const Icon = style.icon;
                      const field = FIELD_BY_TYPE[entry.type];
                      return (
                        <div key={entry.idx} className="px-3 py-2.5">
                          <div className="flex items-start gap-2">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 mt-0.5 shrink-0 ${style.badge}`}>
                              <Icon className="w-3 h-3" />{style.label}
                            </span>
                            <p className="text-sm flex-1">{entry.message}</p>
                          </div>
                          {field ? (
                            <div className="mt-2 ml-1 flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground">
                                {field === 'unit_of_measure' ? 'Change unit of measure to:' : 'Change category to:'}
                              </span>
                              <Select
                                value={edits[entry.idx] ?? SKIP}
                                onValueChange={(value) => setEdit(entry.idx, value)}
                                disabled={applying}
                              >
                                <SelectTrigger className="h-8 w-52 text-sm">
                                  <SelectValue placeholder="No change" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={SKIP}>No change</SelectItem>
                                  {optionsForField(field).map(option => (
                                    <SelectItem key={option} value={option}>
                                      {option}{entry.fix?.value === option ? ' (AI suggested)' : ''}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : entry.fix ? (
                            <button
                              type="button"
                              onClick={() => toggleCheck(entry.idx)}
                              disabled={applying}
                              className="mt-2 ml-1 flex items-center gap-2 text-sm text-primary hover:opacity-80"
                            >
                              {checks.has(entry.idx)
                                ? <CheckSquare className="w-4 h-4" />
                                : <Square className="w-4 h-4" />}
                              {entry.fix.label}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          {reviewing ? (
            <>
              <Button variant="outline" onClick={cancelReview}>Cancel Review</Button>
              <Button onClick={() => onOpenChange(false)}>Run in Background</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={runReview} disabled={applying}>Re-run Review</Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Close</Button>
              {issues.length > 0 && (
                <Button onClick={applyChanges} disabled={applying || changeCount === 0}>
                  {applying ? 'Applying...' : `Apply ${changeCount} Change${changeCount === 1 ? '' : 's'}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
