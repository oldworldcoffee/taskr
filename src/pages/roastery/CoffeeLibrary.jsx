import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { useCompany } from '@/components/roastery/RoasteryContext';
import PageHeader from '@/components/roastery/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Image, MapPin, Mountain, Leaf, Download, X, GripVertical, Archive, ArchiveRestore, Star, ChevronLeft, Images } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'sonner';

const PROCESSES = ['washed', 'natural', 'honey', 'anaerobic', 'wet_hulled', 'other'];
const CERTS = ['Organic', 'Fair Trade', 'Rainforest Alliance', 'Direct Trade', 'Bird Friendly'];

export default function CoffeeLibrary() {
  const { companyId, isManager } = useCompany();
  const [coffees, setCoffees] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterCountry, setFilterCountry] = useState('all');
  const [filterProcess, setFilterProcess] = useState('all');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState(defaultForm());
  const [uploading, setUploading] = useState(false);
  const [confirmDeletePhoto, setConfirmDeletePhoto] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [gallerySelected, setGallerySelected] = useState(null);

  function defaultForm() {
    return {
      name: '', coffee_type: 'single_origin',
      country: '', region: '', farm_name: '', producer: '',
      altitude_min: '', altitude_max: '', process: '', variety: '',
      harvest_year: '', importer: '', tasting_notes: '', farm_story: '',
      cupping_score: '', certifications: [], photos: [], tags: [], is_active: true,
      description: '',
    };
  }

  useEffect(() => { loadData(); }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const data = companyId
      ? await roastery.entities.GreenCoffee.filter({ company_id: companyId })
      : await roastery.entities.GreenCoffee.list('-created_date', 100);
    data.sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
    setCoffees(data);
    setLoading(false);
  };

  const handleArchive = async (coffee) => {
    await roastery.entities.GreenCoffee.update(coffee.id, { is_active: false });
    toast.success(`"${coffee.name}" archived`);
    setConfirmArchive(null);
    loadData();
  };

  const handleUnarchive = async (coffee) => {
    await roastery.entities.GreenCoffee.update(coffee.id, { is_active: true });
    toast.success(`"${coffee.name}" restored`);
    loadData();
  };

  const visibleCoffees = coffees.filter(c => showArchived ? c.is_active === false : c.is_active !== false);

  const countries = [...new Set(coffees.map(c => c.country).filter(Boolean))].sort();

  const filtered = visibleCoffees.filter(c => {
    if (search && !c.name?.toLowerCase().includes(search.toLowerCase()) && !c.country?.toLowerCase().includes(search.toLowerCase()) && !c.farm_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType !== 'all' && c.coffee_type !== filterType) return false;
    if (filterCountry !== 'all' && c.country !== filterCountry) return false;
    if (filterProcess !== 'all' && c.process !== filterProcess) return false;
    return true;
  });

  const handleDragEnd = async (result) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const reordered = Array.from(visibleCoffees);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setCoffees(prev => {
      const archived = prev.filter(c => c.is_active === false);
      return [...reordered, ...archived];
    });
    await Promise.all(reordered.map((c, i) =>
      roastery.entities.GreenCoffee.update(c.id, { sort_order: i })
    ));
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const urls = await Promise.all(files.map(file => roastery.integrations.Core.UploadFile({ file }).then(r => r.file_url)));
    setForm(f => ({ ...f, photos: [...(f.photos || []), ...urls] }));
    setUploading(false);
    toast.success(files.length > 1 ? `${files.length} photos uploaded` : 'Photo uploaded');
  };

  const replacePhoto = async (e, index) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await roastery.integrations.Core.UploadFile({ file });
    setForm(f => {
      const photos = [...(f.photos || [])];
      photos[index] = file_url;
      return { ...f, photos };
    });
    setUploading(false);
    toast.success('Photo replaced');
  };

  const removePhoto = (index) => {
    setConfirmDeletePhoto(index);
  };

  const confirmRemovePhoto = () => {
    setForm(f => ({ ...f, photos: f.photos.filter((_, i) => i !== confirmDeletePhoto) }));
    setConfirmDeletePhoto(null);
  };

  const handleSave = async () => {
    if (!companyId) {
      toast.error('Your account is not linked to a company yet.');
      return;
    }
    const payload = {
      ...form,
      company_id: companyId,
      altitude_min: form.altitude_min ? parseFloat(form.altitude_min) : undefined,
      altitude_max: form.altitude_max ? parseFloat(form.altitude_max) : undefined,
      cupping_score: form.cupping_score ? parseFloat(form.cupping_score) : undefined,
    };
    if (form.id) {
      await roastery.entities.GreenCoffee.update(form.id, payload);
      toast.success('Coffee updated');
    } else {
      await roastery.entities.GreenCoffee.create(payload);
      toast.success('Coffee added');
    }
    setDialog(false);
    setForm(defaultForm());
    loadData();
  };

  const openEdit = (coffee) => {
    setForm({ ...coffee });
    setDialog(true);
  };

  if (loading) return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-8">
      <PageHeader title="Coffee Library" description="Origin information, farm stories, and asset management">
        <Button variant="outline" onClick={() => setShowArchived(a => !a)} className="gap-2">
          {showArchived ? <><ArchiveRestore className="w-4 h-4" /> View Active</> : <><Archive className="w-4 h-4" /> View Archived</>}
        </Button>
        {isManager && companyId && !showArchived && (
          <Button onClick={() => { setForm(defaultForm()); setDialog(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Add Coffee
          </Button>
        )}
      </PageHeader>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search coffees, countries, farms..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="single_origin">Single Origin</SelectItem>
            <SelectItem value="blend">Blend</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCountry} onValueChange={setFilterCountry}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Country" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterProcess} onValueChange={setFilterProcess}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Process" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Processes</SelectItem>
            {PROCESSES.map(p => <SelectItem key={p} value={p} className="capitalize">{p.replace('_', ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        {(filterType !== 'all' || filterCountry !== 'all' || filterProcess !== 'all') && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setFilterType('all'); setFilterCountry('all'); setFilterProcess('all'); }}>
            Clear filters
          </Button>
        )}
      </div>

      {(search || filterType !== 'all' || filterCountry !== 'all' || filterProcess !== 'all') ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.length === 0 ? (
            <div className="col-span-full py-16 text-center text-muted-foreground">No coffees match your filters.</div>
          ) : filtered.map(coffee => (
            <CoffeeCard key={coffee.id} coffee={coffee} isManager={isManager} showArchived={showArchived} onView={() => setViewing(coffee)} onEdit={() => openEdit(coffee)} onArchive={() => setConfirmArchive(coffee)} onUnarchive={() => handleUnarchive(coffee)} />
          ))}
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="coffees" direction="horizontal">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {visibleCoffees.map((coffee, index) => (
                  <Draggable key={coffee.id} draggableId={coffee.id} index={index} isDragDisabled={!isManager || showArchived}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={snapshot.isDragging ? 'opacity-80 shadow-xl' : ''}
                      >
                        <CoffeeCard
                          coffee={coffee}
                          isManager={isManager}
                          showArchived={showArchived}
                          onView={() => setViewing(coffee)}
                          onEdit={() => openEdit(coffee)}
                          onArchive={() => setConfirmArchive(coffee)}
                          onUnarchive={() => handleUnarchive(coffee)}
                          dragHandleProps={provided.dragHandleProps}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
                {coffees.length === 0 && (
                  <div className="col-span-full py-16 text-center text-muted-foreground">
                    <Leaf className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>No coffees found. Add your first green coffee to get started.</p>
                  </div>
                )}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* View Dialog */}
      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewing && (
            <>
              <DialogHeader><DialogTitle>{viewing.name}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                {viewing.photos?.length > 0 && (
                  <div>
                    <div className="flex gap-2 pb-2 flex-wrap">
                      {viewing.photos.slice(0, 4).map((p, i) => (
                        <div key={i} className="relative flex-shrink-0 group cursor-pointer" onClick={() => { setGallerySelected(p); setGalleryOpen(true); }}>
                          <img src={p} alt="" className="h-32 w-48 object-cover rounded-md" />
                          {i === 3 && viewing.photos.length > 4 && (
                            <div className="absolute inset-0 bg-black/50 rounded-md flex items-center justify-center">
                              <span className="text-white font-semibold text-lg">+{viewing.photos.length - 4}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {viewing.photos.length > 4 && (
                      <Button variant="outline" size="sm" className="gap-2 mt-1" onClick={() => { setGallerySelected(null); setGalleryOpen(true); }}>
                        <Images className="w-4 h-4" /> View all {viewing.photos.length} photos
                      </Button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Country', viewing.country], ['Region', viewing.region],
                    ['Farm', viewing.farm_name], ['Producer', viewing.producer],
                    ['Importer', viewing.importer], ['Process', viewing.process],
                    ['Variety', viewing.variety], ['Harvest Year', viewing.harvest_year],
                    ['Altitude', viewing.altitude_min ? `${viewing.altitude_min}–${viewing.altitude_max || '?'}m` : null],
                    ['Cupping Score', viewing.cupping_score],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><span className="text-muted-foreground text-xs">{k}</span><p className="capitalize">{v}</p></div>
                  ))}
                </div>
                {viewing.tasting_notes && <div><p className="text-xs text-muted-foreground mb-1">Tasting Notes</p><p className="text-sm whitespace-pre-wrap">{viewing.tasting_notes}</p></div>}
                {viewing.description && <div><p className="text-xs text-muted-foreground mb-1">Description</p><p className="text-sm leading-relaxed whitespace-pre-wrap">{viewing.description}</p></div>}
                {viewing.farm_story && <div><p className="text-xs text-muted-foreground mb-1">Farm Story</p><p className="text-sm leading-relaxed whitespace-pre-wrap">{viewing.farm_story}</p></div>}
                {viewing.certifications?.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {viewing.certifications.map(c => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Full Gallery Grid */}
      <Dialog open={galleryOpen} onOpenChange={(open) => { setGalleryOpen(open); if (!open) setGallerySelected(null); }}>
        <DialogContent className="max-w-5xl w-full max-h-[90vh] flex flex-col p-0 overflow-hidden" hideClose>
          <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0">
            <h2 className="font-semibold text-sm">{viewing?.name} — Photos ({viewing?.photos?.length})</h2>
            <button onClick={() => setGalleryOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          {gallerySelected ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 flex items-center justify-center bg-muted/30 p-4 overflow-hidden">
                <img src={gallerySelected} alt="" className="max-h-full max-w-full object-contain rounded-md" />
              </div>
              <div className="flex items-center gap-3 px-5 py-3 border-t flex-shrink-0">
                <button onClick={() => setGallerySelected(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <ChevronLeft className="w-3 h-3" /> Back to grid
                </button>
                <a href={gallerySelected} download target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Download className="w-3 h-3" /> Download
                </a>
              </div>
            </div>
          ) : (
            <div className="overflow-y-auto p-4">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {viewing?.photos?.map((p, i) => (
                  <div key={i} className="relative group aspect-square cursor-pointer rounded-md overflow-hidden bg-muted" onClick={() => setGallerySelected(p)}>
                    <img src={p} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    <a
                      href={p}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="absolute bottom-1.5 right-1.5 bg-black/60 text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Download className="w-3 h-3" />
                    </a>
                    {i === 0 && <div className="absolute top-1.5 left-1.5 bg-yellow-400 text-yellow-900 text-[9px] font-bold px-1 py-0.5 rounded-sm leading-none">DEFAULT</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Archive Coffee Confirmation */}
      <AlertDialog open={!!confirmArchive} onOpenChange={(open) => { if (!open) setConfirmArchive(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive "{confirmArchive?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This coffee will be hidden from the active library. You can restore it anytime from the "View Archived" view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleArchive(confirmArchive)}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Photo Confirmation */}
      <AlertDialog open={confirmDeletePhoto !== null} onOpenChange={(open) => { if (!open) setConfirmDeletePhoto(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Photo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this photo from the coffee record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemovePhoto} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit/Add Dialog */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? 'Edit Coffee' : 'Add Green Coffee'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Coffee Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.coffee_type || 'single_origin'} onValueChange={v => setForm(f => ({ ...f, coffee_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_origin">Single Origin</SelectItem>
                  <SelectItem value="blend">Blend</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.coffee_type !== 'blend' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Country</Label><Input value={form.country || ''} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} /></div>
                  <div><Label>Region</Label><Input value={form.region || ''} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} /></div>
                  <div><Label>Farm Name</Label><Input value={form.farm_name || ''} onChange={e => setForm(f => ({ ...f, farm_name: e.target.value }))} /></div>
                  <div><Label>Producer</Label><Input value={form.producer || ''} onChange={e => setForm(f => ({ ...f, producer: e.target.value }))} /></div>
                  <div><Label>Importer</Label><Input value={form.importer || ''} onChange={e => setForm(f => ({ ...f, importer: e.target.value }))} /></div>
                  <div><Label>Variety</Label><Input value={form.variety || ''} onChange={e => setForm(f => ({ ...f, variety: e.target.value }))} /></div>
                  <div><Label>Harvest Year</Label><Input value={form.harvest_year || ''} onChange={e => setForm(f => ({ ...f, harvest_year: e.target.value }))} /></div>
                  <div><Label>Cupping Score</Label><Input type="number" step="0.1" value={form.cupping_score || ''} onChange={e => setForm(f => ({ ...f, cupping_score: e.target.value }))} /></div>
                  <div><Label>Altitude Min (m)</Label><Input type="number" value={form.altitude_min || ''} onChange={e => setForm(f => ({ ...f, altitude_min: e.target.value }))} /></div>
                  <div><Label>Altitude Max (m)</Label><Input type="number" value={form.altitude_max || ''} onChange={e => setForm(f => ({ ...f, altitude_max: e.target.value }))} /></div>
                </div>
                <div>
                  <Label>Process</Label>
                  <Select value={form.process || ''} onValueChange={v => setForm(f => ({ ...f, process: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger>
                    <SelectContent>{PROCESSES.map(p => <SelectItem key={p} value={p} className="capitalize">{p.replace('_', ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Farm Story</Label><Textarea value={form.farm_story || ''} onChange={e => setForm(f => ({ ...f, farm_story: e.target.value }))} rows={3} /></div>
              </>
            )}

            <div><Label>Tasting Notes</Label><Textarea value={form.tasting_notes || ''} onChange={e => setForm(f => ({ ...f, tasting_notes: e.target.value }))} rows={2} /></div>
            <div><Label>Description</Label><Textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="General description of this coffee..." /></div>

            {form.coffee_type !== 'blend' && (
              <div>
                <Label>Certifications</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {CERTS.map(cert => (
                    <button
                      key={cert}
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        certifications: f.certifications?.includes(cert)
                          ? f.certifications.filter(c => c !== cert)
                          : [...(f.certifications || []), cert]
                      }))}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${form.certifications?.includes(cert) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
                    >
                      {cert}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label>Photos</Label>
              <p className="text-xs text-muted-foreground mb-2 mt-0.5">Click the ★ to set the default (listing) photo. It will move to first position.</p>
              <div className="flex flex-wrap gap-2 mb-2 mt-1">
                {form.photos?.map((p, i) => (
                  <div key={i} className="relative group">
                    <img src={p} alt="" className={`h-16 w-24 object-cover rounded border-2 ${i === 0 ? 'border-yellow-400' : 'border-transparent'}`} />
                    {i === 0 && (
                      <div className="absolute top-1 left-1 bg-yellow-400 text-yellow-900 rounded-sm px-1 py-0.5 text-[9px] font-bold leading-none">DEFAULT</div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center gap-1">
                      {i !== 0 && (
                        <button
                          type="button"
                          title="Set as default photo"
                          onClick={() => setForm(f => {
                            const photos = [...f.photos];
                            photos.splice(i, 1);
                            photos.unshift(p);
                            return { ...f, photos };
                          })}
                          className="p-1 rounded bg-white/20 hover:bg-yellow-500/80 text-white"
                        >
                          <Star className="w-3 h-3" />
                        </button>
                      )}
                      <label className="cursor-pointer p-1 rounded bg-white/20 hover:bg-white/40 text-white" title="Replace">
                        <Image className="w-3 h-3" />
                        <input type="file" accept="image/*" className="hidden" onChange={e => replacePhoto(e, i)} disabled={uploading} />
                      </label>
                      <a href={p} download target="_blank" rel="noopener noreferrer" className="p-1 rounded bg-white/20 hover:bg-white/40 text-white" title="Download">
                        <Download className="w-3 h-3" />
                      </a>
                      <button type="button" onClick={() => removePhoto(i)} className="p-1 rounded bg-white/20 hover:bg-red-500/80 text-white" title="Remove">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer text-primary hover:underline">
                <Image className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Upload Photo'}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CoffeeCard({ coffee, isManager, showArchived, onView, onEdit, onArchive, onUnarchive, dragHandleProps }) {
  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={onView}>
      <div className="relative">
        {coffee.photos?.[0] ? (
          <div className="h-40 bg-muted overflow-hidden">
            <img src={coffee.photos[0]} alt={coffee.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="h-40 bg-gradient-to-br from-green-50 to-amber-50 flex items-center justify-center">
            <Leaf className="w-12 h-12 text-primary/30" />
          </div>
        )}
        {isManager && dragHandleProps && (
          <div
            {...dragHandleProps}
            onClick={e => e.stopPropagation()}
            className="absolute top-2 right-2 bg-white/80 rounded p-1 cursor-grab active:cursor-grabbing shadow"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-sm leading-tight">{coffee.name}</h3>
          {coffee.cupping_score && <Badge variant="outline" className="text-xs">{coffee.cupping_score}</Badge>}
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          {coffee.coffee_type === 'blend' ? (
            <>
              <Badge variant="outline" className="text-xs">Blend</Badge>
              {coffee.tasting_notes && <p className="mt-1 line-clamp-2">{coffee.tasting_notes}</p>}
            </>
          ) : (
            <>
              {coffee.country && <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{coffee.country}{coffee.region ? `, ${coffee.region}` : ''}</div>}
              {coffee.farm_name && <div>{coffee.farm_name}</div>}
              {coffee.altitude_min && <div className="flex items-center gap-1"><Mountain className="w-3 h-3" />{coffee.altitude_min}{coffee.altitude_max ? `–${coffee.altitude_max}` : ''}m</div>}
              {coffee.process && <Badge variant="secondary" className="text-xs capitalize mt-1">{coffee.process.replace('_', ' ')}</Badge>}
            </>
          )}
        </div>
        {isManager && (
          <div className="mt-3 flex gap-2">
            {!showArchived && (
              <Button variant="ghost" size="sm" className="flex-1 text-xs" onClick={e => { e.stopPropagation(); onEdit(); }}>Edit</Button>
            )}
            {showArchived ? (
              <Button variant="ghost" size="sm" className="flex-1 text-xs gap-1 text-green-600 hover:text-green-700" onClick={e => { e.stopPropagation(); onUnarchive(); }}>
                <ArchiveRestore className="w-3 h-3" /> Restore
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); onArchive(); }}>
                <Archive className="w-3 h-3" /> Archive
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}