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
import { Plus, Warehouse, MapPin } from 'lucide-react';
import { toast } from 'sonner';

export default function Warehouses() {
  const { companyId, isManager } = useCompany();
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(defaultForm());

  function defaultForm() {
    return { name: '', location_type: 'off_site', city: '', state: '', address: '', importer: '', bags_per_pallet: '', contact_name: '', contact_email: '', contact_phone: '', notes: '' };
  }

  useEffect(() => { if (companyId) loadData(); }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const data = await roastery.entities.WarehouseLocation.filter({ company_id: companyId });
    setWarehouses(data);
    setLoading(false);
  };

  const handleSave = async () => {
    const payload = { ...form, company_id: companyId, bags_per_pallet: form.bags_per_pallet ? parseFloat(form.bags_per_pallet) : undefined, is_active: true };
    if (form.id) await roastery.entities.WarehouseLocation.update(form.id, payload);
    else await roastery.entities.WarehouseLocation.create(payload);
    toast.success('Warehouse saved');
    setDialog(false);
    setForm(defaultForm());
    loadData();
  };

  if (loading) return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-8">
      <PageHeader title="Warehouse Locations" description="On-site and off-site storage locations">
        {isManager && <Button onClick={() => { setForm(defaultForm()); setDialog(true); }} className="gap-2"><Plus className="w-4 h-4" /> Add Location</Button>}
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {warehouses.map(w => (
          <Card key={w.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Warehouse className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold">{w.name}</h3>
                </div>
                <Badge variant="secondary" className="text-xs capitalize">{w.location_type?.replace('_', ' ')}</Badge>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                {(w.city || w.state) && <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{[w.city, w.state].filter(Boolean).join(', ')}</div>}
                {w.importer && <p>Importer: {w.importer}</p>}
                {w.bags_per_pallet && <p>{w.bags_per_pallet} bags/pallet</p>}
                {w.contact_name && <p>Contact: {w.contact_name}</p>}
              </div>
              {isManager && (
                <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => { setForm({ ...w }); setDialog(true); }}>Edit</Button>
              )}
            </CardContent>
          </Card>
        ))}
        {warehouses.length === 0 && (
          <div className="col-span-full py-16 text-center text-muted-foreground">
            <Warehouse className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No warehouse locations yet.</p>
          </div>
        )}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? 'Edit Location' : 'Add Warehouse Location'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Name *</Label><Input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="The Annex" /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.location_type} onValueChange={v=>setForm(f=>({...f,location_type:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on_site">On Site</SelectItem>
                  <SelectItem value="off_site">Off Site</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>City</Label><Input value={form.city||''} onChange={e=>setForm(f=>({...f,city:e.target.value}))} /></div>
              <div><Label>State</Label><Input value={form.state||''} onChange={e=>setForm(f=>({...f,state:e.target.value}))} /></div>
            </div>
            <div><Label>Address</Label><Input value={form.address||''} onChange={e=>setForm(f=>({...f,address:e.target.value}))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Importer</Label><Input value={form.importer||''} onChange={e=>setForm(f=>({...f,importer:e.target.value}))} /></div>
              <div><Label>Bags / Pallet</Label><Input type="number" value={form.bags_per_pallet||''} onChange={e=>setForm(f=>({...f,bags_per_pallet:e.target.value}))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Contact</Label><Input value={form.contact_name||''} onChange={e=>setForm(f=>({...f,contact_name:e.target.value}))} /></div>
              <div><Label>Email</Label><Input value={form.contact_email||''} onChange={e=>setForm(f=>({...f,contact_email:e.target.value}))} /></div>
              <div><Label>Phone</Label><Input value={form.contact_phone||''} onChange={e=>setForm(f=>({...f,contact_phone:e.target.value}))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}