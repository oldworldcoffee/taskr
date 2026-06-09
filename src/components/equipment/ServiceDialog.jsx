import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addDays, format } from "date-fns";

const SERVICE_TYPES = [
  { value: "routine_maintenance", label: "Routine Maintenance" },
  { value: "cleaning", label: "Cleaning" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
  { value: "burr_replacement", label: "Burr Replacement" },
  { value: "calibration", label: "Calibration" },
  { value: "other", label: "Other" },
];

export default function ServiceDialog({ open, onClose, equipment, user, onSaved }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [form, setForm] = useState({
    service_date: today,
    service_type: "routine_maintenance",
    performed_by: "",
    cost: "",
    description: "",
    next_service_date: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (key, val) => {
    const updated = { ...form, [key]: val };
    // Auto-calculate next service date when service_date changes
    if (key === "service_date" && equipment?.service_interval_days) {
      updated.next_service_date = format(addDays(new Date(val), equipment.service_interval_days), "yyyy-MM-dd");
    }
    setForm(updated);
  };

  const handleOpen = () => {
    console.log('ServiceDialog handleOpen - equipment:', equipment);
    const nextDate = equipment?.service_interval_days
      ? format(addDays(new Date(), equipment.service_interval_days), "yyyy-MM-dd")
      : "";
    setForm({
      service_date: today,
      service_type: "routine_maintenance",
      performed_by: "",
      cost: "",
      description: "",
      next_service_date: nextDate,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.ServiceRecord.create({
      equipment_id: equipment.id,
      company_id: equipment.company_id,
      location_id: equipment.location_id,
      service_date: form.service_date,
      service_type: form.service_type,
      performed_by: form.performed_by,
      cost: form.cost ? Number(form.cost) : undefined,
      description: form.description,
      next_service_date: form.next_service_date,
      logged_by_email: user.email,
      logged_by_name: user.full_name,
    });

    // Update the equipment record
    await base44.entities.Equipment.update(equipment.id, {
      last_service_date: form.service_date,
      next_service_date: form.next_service_date || undefined,
    });

    // Update any active schedules matching this service type
    const schedules = await base44.entities.ServiceSchedule.filter({
      equipment_id: equipment.id,
      service_type: form.service_type,
      is_active: true,
    });
    for (const schedule of schedules) {
      await base44.entities.ServiceSchedule.update(schedule.id, {
        last_scheduled_date: form.service_date,
        next_due_date: form.next_service_date || undefined,
      });
    }

    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { console.log('ServiceDialog onOpenChange:', o, 'equipment:', equipment); if (o) handleOpen(); else onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log Service — {equipment?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Service Date *</Label>
              <Input type="date" value={form.service_date} onChange={e => set("service_date", e.target.value)} />
            </div>
            <div>
              <Label>Service Type *</Label>
              <Select value={form.service_type} onValueChange={v => set("service_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Performed By</Label>
              <Input value={form.performed_by} onChange={e => set("performed_by", e.target.value)} placeholder="Name or company" />
            </div>
            <div>
              <Label>Cost ($)</Label>
              <Input type="number" value={form.cost} onChange={e => set("cost", e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div>
            <Label>Next Service Date</Label>
            <Input type="date" value={form.next_service_date} onChange={e => set("next_service_date", e.target.value)} />
            {equipment?.service_interval_days && (
              <p className="text-xs text-muted-foreground mt-1">Auto-calculated from {equipment.service_interval_days}-day interval</p>
            )}
          </div>

          <div>
            <Label>Description / Notes</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} placeholder="What was done?" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.service_date}>
            {saving ? "Saving..." : "Log Service"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}