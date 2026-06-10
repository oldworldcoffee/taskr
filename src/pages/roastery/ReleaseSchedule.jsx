import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import PageHeader from '@/components/roastery/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Calendar, ChevronRight, X, Pencil, Layers } from 'lucide-react';
import BlendRecipeManager from '@/components/roastery/BlendRecipeManager';
import SlotPricingPanel from '@/components/roastery/SlotPricingPanel';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const CATEGORY_TYPES = ['fruity', 'nuanced', 'classic', 'experimental', 'blend', 'decaf', 'seasonal', 'other'];

const STATUS_CONFIG = {
  coming_soon:       { label: 'Coming Soon',   color: 'bg-purple-100 text-purple-700 border-purple-200' },
  waiting_for_input: { label: 'Needs Review',  color: 'bg-amber-100 text-amber-700 border-amber-200'   },
  live_online:       { label: 'Live Online',   color: 'bg-blue-100 text-blue-700 border-blue-200'     },
  live_in_store:     { label: 'Live In Store', color: 'bg-green-100 text-green-700 border-green-200'   },
  retired:           { label: 'Retired',       color: 'bg-gray-100 text-gray-500 border-gray-200'      },
};

const STATUSES = Object.keys(STATUS_CONFIG);

function StatusPill({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.coming_soon;
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', cfg.color)}>{cfg.label}</span>;
}

export default function ReleaseSchedule() {
  const { companyId, isManager, company } = useCompany();
  const [slots, setSlots] = useState([]);
  const [rotations, setRotations] = useState([]);
  const [coffees, setCoffees] = useState([]);
  const [loading, setLoading] = useState(true);

  // Which slot is open in the side panel
  const [selectedSlot, setSelectedSlot] = useState(null);

  // Dialogs
  const [slotDialog, setSlotDialog] = useState(null);
  const [rotationDialog, setRotationDialog] = useState(null); // { slotId, rotation? }

  const [slotForm, setSlotForm] = useState({ name: '', category_type: '', slot_number: '', description: '', color: '' });
  const [rotForm, setRotForm] = useState({ green_coffee_id: '', status: 'coming_soon', go_live_date: '', anticipated_rotation_date: '', notes: '' });

  useEffect(() => { if (companyId) loadData(); }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const [slotsData, rotData, coffeeData] = await Promise.all([
      roastery.entities.CategorySlot.filter({ company_id: companyId, is_active: true }, 'sort_order'),
      roastery.entities.CategoryRotation.filter({ company_id: companyId, is_current: true }),
      roastery.entities.GreenCoffee.filter({ company_id: companyId, is_active: true }),
    ]);
    setSlots(slotsData);
    setRotations(rotData);
    setCoffees(coffeeData);
    setLoading(false);
  };

  const coffeeMap = Object.fromEntries(coffees.map(c => [c.id, c]));

  // All rotations for a given slot
  const rotationsForSlot = (slotId) => rotations.filter(r => r.category_slot_id === slotId);

  // The "active" rotation for a slot (live_in_store or live_online first, else most recent)
  const activeRotation = (slotId) => {
    const all = rotationsForSlot(slotId);
    return all.find(r => r.status === 'live_in_store') ||
           all.find(r => r.status === 'live_online') ||
           all.find(r => r.status === 'waiting_for_input') ||
           all.find(r => r.status === 'coming_soon') ||
           all[0] || null;
  };

  // ── Slot CRUD ──
  const saveSlot = async () => {
    const payload = { ...slotForm, company_id: companyId, slot_number: parseInt(slotForm.slot_number) || 0, is_active: true, color: slotForm.color || null };
    if (slotDialog?.id) await roastery.entities.CategorySlot.update(slotDialog.id, payload);
    else await roastery.entities.CategorySlot.create(payload);
    toast.success('Category slot saved');
    setSlotDialog(null);
    loadData();
  };

  const openSlotEdit = (slot) => {
    setSlotForm({ name: slot.name, category_type: slot.category_type || '', slot_number: slot.slot_number || '', description: slot.description || '', color: slot.color || '' });
    setSlotDialog(slot);
  };

  // ── Rotation CRUD ──
  const openNewRotation = (slotId) => {
    setRotForm({ green_coffee_id: '', status: 'coming_soon', go_live_date: '', anticipated_rotation_date: '', notes: '' });
    setRotationDialog({ slotId });
  };

  const openEditRotation = (rotation) => {
    setRotForm({
      green_coffee_id: rotation.green_coffee_id || '',
      status: rotation.status || 'coming_soon',
      go_live_date: rotation.go_live_date || '',
      anticipated_rotation_date: rotation.anticipated_rotation_date || '',
      notes: rotation.notes || '',
    });
    setRotationDialog({ slotId: rotation.category_slot_id, rotation });
  };

  const saveRotation = async () => {
    const { slotId, rotation } = rotationDialog;
    const payload = { ...rotForm, company_id: companyId, category_slot_id: slotId, is_current: true };
    if (rotation?.id) await roastery.entities.CategoryRotation.update(rotation.id, payload);
    else await roastery.entities.CategoryRotation.create(payload);
    toast.success('Rotation saved');
    setRotationDialog(null);
    loadData();
  };

  const deleteRotation = async (rotation) => {
    await roastery.entities.CategoryRotation.delete(rotation.id);
    toast.success('Removed');
    loadData();
  };

  const updateRotationStatus = async (rotation, newStatus) => {
    await roastery.entities.CategoryRotation.update(rotation.id, { status: newStatus });
    loadData();
  };

  const selectedSlotData = selectedSlot ? slots.find(s => s.id === selectedSlot) : null;
  const selectedRotations = selectedSlot ? rotationsForSlot(selectedSlot) : [];
  const isBlendSlot = selectedSlotData?.category_type === 'blend';

  // For blend slots, find the single assigned blend coffee (we store it as a rotation but don't queue)
  const blendRotation = isBlendSlot ? (rotationsForSlot(selectedSlot)[0] || null) : null;
  const blendCoffee = blendRotation?.green_coffee_id ? coffeeMap[blendRotation.green_coffee_id] : null;

  if (loading) return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-8 flex gap-6 h-full">
      {/* ── LEFT: Slot list ── */}
      <div className={cn('flex flex-col gap-3 transition-all', selectedSlot ? 'w-72 flex-shrink-0' : 'flex-1 max-w-xl')}>
        <PageHeader title="Release Schedule" description="Select a slot to manage its coffee queue.">
          {isManager && (
            <Button onClick={() => { setSlotForm({ name: '', category_type: '', slot_number: '', description: '' }); setSlotDialog({}); }} className="gap-2">
              <Plus className="w-4 h-4" /> Add Slot
            </Button>
          )}
        </PageHeader>

        {slots.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No category slots yet. Add your first slot (e.g. "Fruity #1")</p>
          </div>
        ) : (
          <div className="space-y-2">
            {slots.map(slot => {
            const isBlend = slot.category_type === 'blend';
            const active = activeRotation(slot.id);
            const count = rotationsForSlot(slot.id).length;
            const coffee = active?.green_coffee_id ? coffeeMap[active.green_coffee_id] : null;
            const isSelected = selectedSlot === slot.id;
            const slotColor = slot.color || null;
            return (
              <div
                key={slot.id}
                onClick={() => setSelectedSlot(isSelected ? null : slot.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all group',
                  isSelected
                    ? 'border-primary bg-accent shadow-sm'
                    : 'border-border bg-card hover:border-primary/40 hover:bg-accent/30'
                )}
                style={slotColor ? { borderLeftColor: slotColor, borderLeftWidth: '4px' } : {}}
              >
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {slotColor && (
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: slotColor }} />
                      )}
                      {isBlend && <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                      <span className="font-medium text-sm text-foreground">{slot.name}</span>
                      {slot.category_type && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{slot.category_type}</span>
                      )}
                    </div>
                    {coffee ? (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground truncate">{coffee.name}</span>
                        {!isBlend && active && <StatusPill status={active.status} />}
                        {isBlend && <span className="text-[10px] text-muted-foreground italic">static blend</span>}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">{isBlend ? 'No blend assigned' : 'No coffee assigned'}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!isBlend && count > 1 && (
                      <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">{count} queued</span>
                    )}
                    <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', isSelected && 'rotate-180')} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── RIGHT: Slot detail panel ── */}
      {selectedSlotData && (
        <div className="flex-1 bg-card border border-border rounded-xl p-6 flex flex-col gap-4 min-w-0">
          {/* Panel header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-heading font-semibold text-foreground">{selectedSlotData.name}</h2>
              {selectedSlotData.category_type && (
                <p className="text-sm text-muted-foreground capitalize">{selectedSlotData.category_type}</p>
              )}
              {selectedSlotData.description && (
                <p className="text-sm text-muted-foreground mt-1">{selectedSlotData.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isManager && (
                <>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => openSlotEdit(selectedSlotData)}>
                    <Pencil className="w-3 h-3" /> Edit Slot
                  </Button>
                  {!isBlendSlot && (
                    <Button size="sm" className="gap-1" onClick={() => openNewRotation(selectedSlot)}>
                      <Plus className="w-3 h-3" /> Add Coffee
                    </Button>
                  )}
                  {isBlendSlot && !blendCoffee && (
                    <Button size="sm" className="gap-1" onClick={() => openNewRotation(selectedSlot)}>
                      <Plus className="w-3 h-3" /> Assign Blend
                    </Button>
                  )}
                </>
              )}
              <Button variant="ghost" size="icon" onClick={() => setSelectedSlot(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <hr className="border-border" />

          {/* Slot pricing + margin health */}
          <SlotPricingPanel
            slot={selectedSlotData}
            coffees={coffees}
            rotations={selectedRotations}
            blendCoffeeId={blendCoffee?.id || null}
            isManager={isManager}
            company={company}
            onSlotUpdated={loadData}
          />

          <hr className="border-border" />

          {/* Blend slot: static blend + recipe manager */}
          {isBlendSlot ? (
            blendCoffee ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">{blendCoffee.name}</span>
                    <span className="text-xs text-muted-foreground italic">static blend</span>
                  </div>
                  {isManager && (
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground px-2"
                      onClick={() => openEditRotation(blendRotation)}>
                      <Pencil className="w-3 h-3 mr-1" /> Change Blend
                    </Button>
                  )}
                </div>
                <BlendRecipeManager
                  blendId={blendCoffee.id}
                  companyId={companyId}
                  coffees={coffees}
                  isManager={isManager}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-10">
                <Layers className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No blend assigned to this slot yet.</p>
                {isManager && (
                  <Button className="mt-4 gap-1" size="sm" onClick={() => openNewRotation(selectedSlot)}>
                    <Plus className="w-3 h-3" /> Assign Blend
                  </Button>
                )}
              </div>
            )
          ) : (
            /* Single-origin rotation queue */
            selectedRotations.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-10">
                <Calendar className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No coffees scheduled for this slot yet.</p>
                {isManager && (
                  <Button className="mt-4 gap-1" size="sm" onClick={() => openNewRotation(selectedSlot)}>
                    <Plus className="w-3 h-3" /> Add Coffee
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {selectedRotations
                  .sort((a, b) => {
                    const order = { live_in_store: 0, live_online: 1, waiting_for_input: 2, coming_soon: 3, retired: 4 };
                    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
                  })
                  .map(rotation => {
                    const coffee = rotation.green_coffee_id ? coffeeMap[rotation.green_coffee_id] : null;
                    return (
                      <div key={rotation.id} className="flex items-start gap-4 p-4 rounded-xl border border-border bg-background group/row">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{coffee?.name || <span className="italic text-muted-foreground">No coffee</span>}</span>
                            <StatusPill status={rotation.status} />
                          </div>
                          {coffee?.country && (
                            <p className="text-xs text-muted-foreground">{coffee.country}{coffee.region ? ` · ${coffee.region}` : ''}</p>
                          )}
                          <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                            {rotation.go_live_date && <span>Go live: {rotation.go_live_date}</span>}
                            {rotation.anticipated_rotation_date && <span>Rotate out: {rotation.anticipated_rotation_date}</span>}
                          </div>
                          {rotation.notes && <p className="text-xs text-muted-foreground mt-1 italic">{rotation.notes}</p>}
                        </div>
                        {isManager && (
                          <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity flex-shrink-0">
                            <Select value={rotation.status} onValueChange={v => {
                              if (v === 'waiting_for_input') { openEditRotation({ ...rotation, status: v }); }
                              else updateRotationStatus(rotation, v);
                            }}>
                              <SelectTrigger className="h-7 text-xs w-36 border-dashed">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUSES.map(s => (
                                  <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditRotation(rotation)}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteRotation(rotation)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )
          )}
        </div>
      )}

      {/* ── Slot Dialog ── */}
      <Dialog open={!!slotDialog} onOpenChange={() => setSlotDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{slotDialog?.id ? 'Edit Slot' : 'Add Category Slot'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Slot Name *</Label><Input value={slotForm.name} onChange={e=>setSlotForm(f=>({...f,name:e.target.value}))} placeholder="Fruity #1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category Type</Label>
                <Select value={slotForm.category_type||''} onValueChange={v=>setSlotForm(f=>({...f,category_type:v}))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>{CATEGORY_TYPES.map(t=><SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Sort Order</Label><Input type="number" value={slotForm.slot_number||''} onChange={e=>setSlotForm(f=>({...f,slot_number:e.target.value}))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Description</Label><Textarea value={slotForm.description||''} onChange={e=>setSlotForm(f=>({...f,description:e.target.value}))} rows={2} /></div>
              <div>
                <Label>Slot Color</Label>
                <div className="flex gap-2 items-center">
                  <Input type="color" value={slotForm.color||'#000000'} onChange={e=>setSlotForm(f=>({...f,color:e.target.value}))} className="w-12 h-9 p-1" />
                  <Input type="text" value={slotForm.color||''} onChange={e=>setSlotForm(f=>({...f,color:e.target.value}))} placeholder="#000000" className="flex-1" />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setSlotDialog(null)}>Cancel</Button>
            <Button onClick={saveSlot} disabled={!slotForm.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rotation Dialog ── */}
      <Dialog open={!!rotationDialog} onOpenChange={() => setRotationDialog(null)}>
        <DialogContent>
          {(() => {
            const dialogSlot = slots.find(s => s.id === rotationDialog?.slotId);
            const isBlendDialog = dialogSlot?.category_type === 'blend';
            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {isBlendDialog
                      ? (rotationDialog?.rotation ? 'Change Assigned Blend' : 'Assign Blend to Slot')
                      : (rotationDialog?.rotation ? 'Edit Coffee' : 'Add Coffee to Queue')}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>{isBlendDialog ? 'Blend *' : 'Coffee *'}</Label>
                    <Select value={rotForm.green_coffee_id||''} onValueChange={v=>setRotForm(f=>({...f,green_coffee_id:v}))}>
                      <SelectTrigger><SelectValue placeholder={isBlendDialog ? 'Select blend' : 'Select coffee'} /></SelectTrigger>
                      <SelectContent>
                        {(isBlendDialog
                          ? coffees.filter(c => c.coffee_type === 'blend')
                          : coffees.filter(c => c.coffee_type !== 'blend')
                        ).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {!isBlendDialog && (
                    <>
                      <div>
                        <Label>Status</Label>
                        <Select value={rotForm.status} onValueChange={v=>setRotForm(f=>({...f,status:v}))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{STATUSES.map(s=><SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Go Live Date</Label><Input type="date" value={rotForm.go_live_date||''} onChange={e=>setRotForm(f=>({...f,go_live_date:e.target.value}))} /></div>
                        <div><Label>Anticipated Rotation</Label><Input type="date" value={rotForm.anticipated_rotation_date||''} onChange={e=>setRotForm(f=>({...f,anticipated_rotation_date:e.target.value}))} /></div>
                      </div>
                    </>
                  )}
                  {rotForm.status === 'waiting_for_input' ? (
                     <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                       <Label className="text-amber-700 font-semibold">Review Note <span className="font-normal text-xs">(shown on dashboard)</span></Label>
                       <Textarea
                         value={rotForm.notes||''}
                         onChange={e=>setRotForm(f=>({...f,notes:e.target.value}))}
                         rows={2}
                         placeholder="What needs to be reviewed? e.g. Waiting on cupping results, price not confirmed..."
                         className="border-amber-300 focus-visible:ring-amber-400"
                       />
                     </div>
                   ) : (
                     <div><Label>Notes</Label><Textarea value={rotForm.notes||''} onChange={e=>setRotForm(f=>({...f,notes:e.target.value}))} rows={2} /></div>
                   )}
                </div>
              </>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={()=>setRotationDialog(null)}>Cancel</Button>
            <Button onClick={saveRotation} disabled={!rotForm.green_coffee_id}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}