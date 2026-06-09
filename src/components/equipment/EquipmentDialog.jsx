import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = [
  { value: "espresso_machine", label: "Espresso Machine" },
  { value: "grinder", label: "Grinder" },
  { value: "brewer", label: "Brewer" },
  { value: "refrigeration", label: "Refrigeration" },
  { value: "dishwasher", label: "Dishwasher" },
  { value: "other", label: "Other" },
];

const defaultForm = {
  name: "", category: "other", model: "", serial_number: "",
  purchase_date: "", last_service_date: "", location_id: "", notes: "",
};

export default function EquipmentDialog({ open, onClose, equipment, user, locations = [], onSaved }) {
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (equipment) {
      setForm({ ...defaultForm, ...equipment });
    } else {
      setForm({ ...defaultForm });
    }
  }, [equipment, open]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    const data = { ...form, company_id: user.company_id };
    if (equipment) {
      await base44.entities.Equipment.update(equipment.id, data);
    } else {
      await base44.entities.Equipment.create(data);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const handleArchive = async () => {
    await base44.entities.Equipment.update(equipment.id, { is_active: false });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{equipment ? "Edit Equipment" : "Add Equipment"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Espresso Machine #1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location *</Label>
              <Select value={form.location_id} onValueChange={v => set("location_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Make / Model</Label>
              <Input value={form.model} onChange={e => set("model", e.target.value)} placeholder="e.g. La Marzocco GB5" />
            </div>
            <div>
              <Label>Serial Number</Label>
              <Input value={form.serial_number} onChange={e => set("serial_number", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" value={form.purchase_date} onChange={e => set("purchase_date", e.target.value)} />
            </div>
            <div>
              <Label>Last Service Date</Label>
              <Input type="date" value={form.last_service_date} onChange={e => set("last_service_date", e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={3} />
          </div>
        </div>

        <div className="flex justify-between pt-4">
          {equipment && (
            <Button variant="destructive" size="sm" onClick={handleArchive}>Archive</Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.location_id}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}