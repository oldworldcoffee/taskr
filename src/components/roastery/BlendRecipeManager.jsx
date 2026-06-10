import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Groups BlendComponentRotation records by a shared key (go_live_date + status bucket)
// Records in the same "recipe version" share the same go_live_date
function groupByVersion(records) {
  const groups = {};
  for (const r of records) {
    const key = r.go_live_date || '__no_date__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return groups;
}

function pct(components) {
  return components.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
}

// Status pill for recipe change stages
const STAGE_CONFIG = {
  upcoming:          { label: 'Scheduled',    color: 'bg-purple-100 text-purple-700 border-purple-200' },
  waiting_for_input: { label: 'Needs Review', color: 'bg-amber-100 text-amber-700 border-amber-200'   },
  live:              { label: 'Live',          color: 'bg-green-100 text-green-700 border-green-200'   },
  retired:           { label: 'Retired',       color: 'bg-gray-100 text-gray-500 border-gray-200'      },
};

function StagePill({ status }) {
  const cfg = STAGE_CONFIG[status] || STAGE_CONFIG.upcoming;
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', cfg.color)}>
      {cfg.label}
    </span>
  );
}

export default function BlendRecipeManager({ blendId, companyId, coffees, isManager }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addDialog, setAddDialog] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  // new recipe form
  const [newGoLive, setNewGoLive] = useState('');
  const [newComponents, setNewComponents] = useState([
    { green_coffee_id: '', percentage: '' },
    { green_coffee_id: '', percentage: '' },
  ]);

  const coffeeMap = Object.fromEntries(coffees.map(c => [c.id, c]));
  const singleOrigins = coffees.filter(c => c.coffee_type !== 'blend');

  const load = async () => {
    setLoading(true);
    const data = await roastery.entities.BlendComponentRotation.filter({ blend_id: blendId });
    setRecords(data);
    setLoading(false);
  };

  useEffect(() => { if (blendId) load(); }, [blendId]);

  const retireGroup = async (group) => {
    await Promise.all(group.map(r => roastery.entities.BlendComponentRotation.update(r.id, { status: 'retired' })));
    toast.success('Recipe retired');
    load();
  };

  const deleteGroup = async (group) => {
    await Promise.all(group.map(r => roastery.entities.BlendComponentRotation.delete(r.id)));
    toast.success('Recipe removed');
    load();
  };

  const saveNewRecipe = async () => {
    const total = pct(newComponents);
    if (total !== 100) { toast.error(`Components must sum to 100% (currently ${total}%)`); return; }
    if (newComponents.some(c => !c.green_coffee_id)) { toast.error('Please select a coffee for each component'); return; }
    await Promise.all(
      newComponents.map(c =>
        roastery.entities.BlendComponentRotation.create({
          company_id: companyId,
          blend_id: blendId,
          component_coffee_id: c.green_coffee_id,
          percentage: parseFloat(c.percentage),
          status: 'upcoming',
          go_live_date: newGoLive || null,
        })
      )
    );
    toast.success('Recipe change scheduled');
    setAddDialog(false);
    setNewGoLive('');
    setNewComponents([{ green_coffee_id: '', percentage: '' }, { green_coffee_id: '', percentage: '' }]);
    load();
  };

  if (loading) return <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const liveRecords = records.filter(r => r.status === 'live');
  const activeRecords = records.filter(r => r.status === 'upcoming' || r.status === 'waiting_for_input');
  const retiredRecords = records.filter(r => r.status === 'retired');

  // Group non-live active records by go_live_date
  const activeGroups = groupByVersion(activeRecords);
  // Sort groups: waiting_for_input first, then upcoming, then by date
  const sortedGroups = Object.entries(activeGroups).sort(([, a], [, b]) => {
    const statusOrder = { waiting_for_input: 0, upcoming: 1 };
    const aOrder = statusOrder[a[0]?.status] ?? 2;
    const bOrder = statusOrder[b[0]?.status] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a[0]?.go_live_date || '').localeCompare(b[0]?.go_live_date || '');
  });

  return (
    <div className="space-y-4">
      {/* Current Live Recipe */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-foreground">Current Recipe</h4>
          {isManager && (
            <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setAddDialog(true)}>
              <Plus className="w-3 h-3" /> Schedule Change
            </Button>
          )}
        </div>
        {liveRecords.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No live recipe yet.</p>
        ) : (
          <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 space-y-1.5">
            {liveRecords.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span>{coffeeMap[r.component_coffee_id]?.name || 'Unknown'}</span>
                <span className="font-medium text-primary">{r.percentage}%</span>
              </div>
            ))}
            <div className="border-t border-green-200 pt-1 flex justify-between text-xs text-muted-foreground">
              <span>Total</span>
              <span className={pct(liveRecords) === 100 ? 'text-primary font-medium' : 'text-destructive font-medium'}>
                {pct(liveRecords)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Pipeline: upcoming + needs review changes */}
      {sortedGroups.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Recipe Changes</h4>
          <div className="space-y-2">
            {sortedGroups.map(([dateKey, group]) => {
              const stage = group[0]?.status;
              const isReview = stage === 'waiting_for_input';
              return (
                <div key={dateKey} className={cn(
                  'rounded-lg border p-3',
                  isReview ? 'border-amber-200 bg-amber-50/40' : 'border-dashed border-border bg-background'
                )}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StagePill status={stage} />
                      {dateKey !== '__no_date__' && (
                        <span className="text-xs text-muted-foreground">Go live: {dateKey}</span>
                      )}
                    </div>
                    {isManager && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs bg-green-50 hover:bg-green-100 border-green-200 text-green-700"
                          onClick={async () => {
                            // First retire the current live recipe
                            const currentLive = records.filter(r => r.status === 'live');
                            if (currentLive.length > 0) {
                              await Promise.all(currentLive.map(r => roastery.entities.BlendComponentRotation.update(r.id, { status: 'retired' })));
                            }
                            // Then mark the new group as live
                            await Promise.all(group.map(r => roastery.entities.BlendComponentRotation.update(r.id, { status: 'live' })));
                            toast.success('Recipe updated - previous recipe retired');
                            load();
                          }}
                        >
                          Make Live
                        </Button>
                        <Select value={stage} onValueChange={async (v) => {
                          if (v === 'remove') { deleteGroup(group); return; }
                          if (v === 'live') return; // handled by button
                          await Promise.all(group.map(r => roastery.entities.BlendComponentRotation.update(r.id, { status: v })));
                          toast.success('Status updated');
                          load();
                        }}>
                          <SelectTrigger className="h-7 text-xs w-28 border-dashed">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="upcoming">Scheduled</SelectItem>
                            <SelectItem value="waiting_for_input">Needs Review</SelectItem>
                            <SelectItem value="remove" className="text-destructive">Remove</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    {group.map(r => (
                      <div key={r.id} className="flex justify-between text-sm">
                        <span>{coffeeMap[r.component_coffee_id]?.name || 'Unknown'}</span>
                        <span className="font-medium">{r.percentage}%</span>
                      </div>
                    ))}
                    <div className="border-t border-border/50 pt-1 flex justify-between text-xs text-muted-foreground">
                      <span>Total</span>
                      <span className={pct(group) === 100 ? 'text-primary font-medium' : 'text-destructive font-medium'}>
                        {pct(group)}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Retired history (collapsed) */}
      {retiredRecords.length > 0 && (
        <>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowRetired(r => !r)}
          >
            {showRetired ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {retiredRecords.length} retired component{retiredRecords.length > 1 ? 's' : ''}
          </button>
          {showRetired && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1 opacity-60">
              {retiredRecords.map(r => (
                <div key={r.id} className="flex justify-between text-sm line-through text-muted-foreground">
                  <span>{coffeeMap[r.component_coffee_id]?.name || 'Unknown'}</span>
                  <span>{r.percentage}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Schedule Change Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Schedule Recipe Change</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Go Live Date</Label>
              <Input type="date" value={newGoLive} onChange={e => setNewGoLive(e.target.value)} />
            </div>
            <div>
              <Label className="mb-2 block">Components</Label>
              <div className="space-y-2">
                {newComponents.map((comp, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="flex-1">
                      <Select value={comp.green_coffee_id} onValueChange={v => {
                        const updated = [...newComponents];
                        updated[i] = { ...updated[i], green_coffee_id: v };
                        setNewComponents(updated);
                      }}>
                        <SelectTrigger><SelectValue placeholder="Select coffee" /></SelectTrigger>
                        <SelectContent>
                          {singleOrigins.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20 flex items-center gap-1">
                      <Input type="number" min="0" max="100" placeholder="%" value={comp.percentage}
                        onChange={e => {
                          const updated = [...newComponents];
                          updated[i] = { ...updated[i], percentage: e.target.value };
                          setNewComponents(updated);
                        }} />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => setNewComponents(c => c.filter((_, j) => j !== i))}
                      disabled={newComponents.length <= 2}>
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2">
                <Button variant="outline" size="sm" className="gap-1 text-xs"
                  onClick={() => setNewComponents(c => [...c, { green_coffee_id: '', percentage: '' }])}>
                  <Plus className="w-3 h-3" /> Add Component
                </Button>
                <span className={cn('text-sm font-medium', pct(newComponents) === 100 ? 'text-primary' : 'text-destructive')}>
                  Total: {pct(newComponents)}%
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>Cancel</Button>
            <Button onClick={saveNewRecipe}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}