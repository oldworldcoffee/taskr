import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Wrench, Calendar, CheckCircle } from "lucide-react";
import { format, parseISO, addDays } from "date-fns";
import { toast } from "sonner";

const SERVICE_TYPE_LABELS = {
  routine_maintenance: "Routine Maintenance",
  cleaning: "Cleaning",
  repair: "Repair",
  inspection: "Inspection",
  burr_replacement: "Burr Replacement",
  calibration: "Calibration",
  other: "Other",
};

const PRESET_INTERVALS = [90, 180, 365];

export default function ServiceScheduleDialog({ equipment, open, onClose, onSaved }) {
  const [schedules, setSchedules] = useState([]);
  const [customInterval, setCustomInterval] = useState("");
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [editFormData, setEditFormData] = useState(null);
  const [newSchedule, setNewSchedule] = useState({
    service_type: "cleaning",
    interval_days: 90,
    last_scheduled_date: format(new Date(), "yyyy-MM-dd"),
    notes: "",
    is_custom_interval: false,
  });

  useEffect(() => {
    if (open) {
      loadSchedules();
    }
  }, [open]);

  const loadSchedules = async () => {
    const all = await base44.entities.ServiceSchedule.filter({ 
      equipment_id: equipment.id, 
      is_active: true 
    }, "-next_due_date");
    setSchedules(all);
  };

  const handleAddSchedule = async () => {
    if (!newSchedule.service_type || !newSchedule.interval_days || !newSchedule.last_scheduled_date) {
      return;
    }

    const nextDue = addDays(parseISO(newSchedule.last_scheduled_date), newSchedule.interval_days);
    const nextDueStr = format(nextDue, "yyyy-MM-dd");

    console.log('Creating new schedule with next_due_date:', nextDueStr);

    await base44.entities.ServiceSchedule.create({
      equipment_id: equipment.id,
      company_id: equipment.company_id,
      location_id: equipment.location_id,
      service_type: newSchedule.service_type,
      interval_days: newSchedule.interval_days,
      last_scheduled_date: newSchedule.last_scheduled_date,
      next_due_date: nextDueStr,
      notes: newSchedule.notes,
      is_active: true,
    });

    // Reload all schedules fresh
    const allSchedules = await base44.entities.ServiceSchedule.filter({ 
      equipment_id: equipment.id, 
      is_active: true 
    });
    
    console.log('All active schedules after create:', allSchedules.map(s => ({ type: s.service_type, next: s.next_due_date, interval: s.interval_days })));
    
    // Sort by next_due_date ASCENDING (earliest first)
    const sorted = allSchedules
      .filter(s => s.next_due_date)
      .sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date));
    
    const earliestNextDue = sorted.length > 0 ? sorted[0].next_due_date : null;

    console.log('Earliest next_due_date:', earliestNextDue);
    console.log('Equipment ID:', equipment.id, 'Current next_service_date:', equipment.next_service_date);

    await base44.entities.Equipment.update(equipment.id, {
      next_service_date: earliestNextDue,
    });

    // Verify equipment update
    const updatedEquipment = await base44.entities.Equipment.get(equipment.id);
    console.log('Equipment updated - next_service_date:', updatedEquipment.next_service_date);

    setNewSchedule({
      service_type: "cleaning",
      interval_days: 90,
      last_scheduled_date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
    });
    if (onSaved) onSaved();
  };

  const handleDeleteSchedule = async (scheduleId) => {
    await base44.entities.ServiceSchedule.update(scheduleId, { is_active: false });
    await loadSchedules();
  };

  const handleEditSchedule = (schedule) => {
    setEditingSchedule(schedule);
    setEditFormData({
      service_type: schedule.service_type,
      interval_days: schedule.interval_days,
      last_scheduled_date: schedule.last_scheduled_date,
      notes: schedule.notes || "",
      is_custom_interval: !PRESET_INTERVALS.includes(schedule.interval_days),
    });
    if (!PRESET_INTERVALS.includes(schedule.interval_days)) {
      setCustomInterval(String(schedule.interval_days));
    }
  };

  const handleSaveEdit = async () => {
    if (!editingSchedule) return;

    const nextDue = addDays(parseISO(editFormData.last_scheduled_date), editFormData.interval_days);
    const nextDueStr = format(nextDue, "yyyy-MM-dd");

    console.log('Before update - Schedule:', editingSchedule.id, 'New next_due_date:', nextDueStr);

    await base44.entities.ServiceSchedule.update(editingSchedule.id, {
      service_type: editFormData.service_type,
      interval_days: editFormData.interval_days,
      last_scheduled_date: editFormData.last_scheduled_date,
      next_due_date: nextDueStr,
      notes: editFormData.notes,
    });

    // Verify the update worked
    const updatedSchedule = await base44.entities.ServiceSchedule.get(editingSchedule.id);
    console.log('After update - Schedule next_due_date:', updatedSchedule.next_due_date);

    // Reload all schedules fresh
    const allSchedules = await base44.entities.ServiceSchedule.filter({ 
      equipment_id: equipment.id, 
      is_active: true 
    });
    
    console.log('All active schedules:', allSchedules.map(s => ({ type: s.service_type, next: s.next_due_date, interval: s.interval_days })));
    
    // Sort by next_due_date ASCENDING (earliest first)
    const sorted = allSchedules
      .filter(s => s.next_due_date)
      .sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date));
    
    const earliestNextDue = sorted.length > 0 ? sorted[0].next_due_date : null;

    console.log('Earliest next_due_date:', earliestNextDue);
    console.log('Equipment ID:', equipment.id, 'Current next_service_date:', equipment.next_service_date);

    await base44.entities.Equipment.update(equipment.id, {
      next_service_date: earliestNextDue,
    });

    // Verify equipment update
    const updatedEquipment = await base44.entities.Equipment.get(equipment.id);
    console.log('Equipment updated - next_service_date:', updatedEquipment.next_service_date);

    setEditingSchedule(null);
    setEditFormData(null);
    if (onSaved) onSaved();
  };

  const handleLogService = async (schedule) => {
    console.log("handleLogService called with:", schedule);
    try {
      const serviceDate = format(new Date(), "yyyy-MM-dd");
      const nextDue = addDays(new Date(), schedule.interval_days);

      console.log("Creating service record...");
      // Create service record
      await base44.entities.ServiceRecord.create({
        equipment_id: equipment.id,
        company_id: equipment.company_id,
        location_id: equipment.location_id,
        service_date: serviceDate,
        service_type: schedule.service_type,
        performed_by: "Scheduled Service",
        description: `Scheduled ${SERVICE_TYPE_LABELS[schedule.service_type]} - ${schedule.notes || "No notes"}`,
        next_service_date: format(nextDue, "yyyy-MM-dd"),
      });

      console.log("Updating schedule...");
      // Update schedule
      await base44.entities.ServiceSchedule.update(schedule.id, {
        last_scheduled_date: serviceDate,
        next_due_date: format(nextDue, "yyyy-MM-dd"),
      });

      console.log("Updating equipment...");
      // Update equipment
      await base44.entities.Equipment.update(equipment.id, {
        last_service_date: serviceDate,
        next_service_date: format(nextDue, "yyyy-MM-dd"),
      });

      console.log("Done! Service logged.");
      toast.success("Service logged successfully");
      await loadSchedules();
      if (onSaved) onSaved();
      onClose();
    } catch (error) {
      console.error("Failed to log service:", error);
    }
  };

  if (!equipment) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Service Schedule - {equipment.name}</DialogTitle>
        </DialogHeader>
        <DialogClose className="absolute right-4 top-4" />

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {/* Add New Schedule */}
            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add Service Schedule
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Service Type</Label>
                  <Select
                    value={newSchedule.service_type}
                    onValueChange={(value) => setNewSchedule({ ...newSchedule, service_type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SERVICE_TYPE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Interval (days)</Label>
                  <div className="flex gap-2">
                    <Select
                      value={newSchedule.is_custom_interval ? "custom" : String(newSchedule.interval_days)}
                      onValueChange={(value) => {
                        if (value === "custom") {
                          setNewSchedule({ ...newSchedule, is_custom_interval: true, interval_days: 90 });
                          setCustomInterval("90");
                        } else {
                          setNewSchedule({ ...newSchedule, is_custom_interval: false, interval_days: parseInt(value) });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRESET_INTERVALS.map((days) => (
                          <SelectItem key={days} value={String(days)}>{days} days</SelectItem>
                        ))}
                        <SelectItem value="custom">Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newSchedule.is_custom_interval && (
                    <Input
                      type="number"
                      value={customInterval}
                      onChange={(e) => {
                        setCustomInterval(e.target.value);
                        setNewSchedule({ ...newSchedule, interval_days: parseInt(e.target.value) || 0 });
                      }}
                      placeholder="Enter days"
                      className="mt-2"
                    />
                  )}
                </div>

                <div>
                  <Label>Last Performed</Label>
                  <Input
                    type="date"
                    value={newSchedule.last_scheduled_date}
                    onChange={(e) => setNewSchedule({ ...newSchedule, last_scheduled_date: e.target.value })}
                  />
                </div>

                <div>
                  <Label>Notes (optional)</Label>
                  <Input
                    placeholder="e.g. Deep clean"
                    value={newSchedule.notes}
                    onChange={(e) => setNewSchedule({ ...newSchedule, notes: e.target.value })}
                  />
                </div>
              </div>

              <Button onClick={handleAddSchedule} className="w-full mt-4">
                <Plus className="w-4 h-4 mr-2" />
                Add Schedule
              </Button>
            </div>

            {/* Existing Schedules */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Active Schedules ({schedules.length})
              </h4>

              {schedules.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6 bg-muted/30 rounded-lg">
                  No service schedules set. Add one above.
                </div>
              ) : (
                <div className="space-y-2">
                  {schedules.map((schedule) => {
                    const daysUntil = schedule.next_due_date
                      ? Math.ceil((parseISO(schedule.next_due_date) - new Date()) / (1000 * 60 * 60 * 24))
                      : null;
                    const isOverdue = daysUntil !== null && daysUntil < 0;
                    const isDueSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 14;

                    const isEditing = editingSchedule?.id === schedule.id;

                    return (
                      <div key={schedule.id} className="border border-border rounded-lg p-3 bg-card">
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Service Type</Label>
                                <Select
                                  value={editFormData.service_type}
                                  onValueChange={(value) => setEditFormData({ ...editFormData, service_type: value })}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(SERVICE_TYPE_LABELS).map(([key, label]) => (
                                      <SelectItem key={key} value={key}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label>Interval (days)</Label>
                                <Input
                                  type="number"
                                  value={editFormData.interval_days}
                                  onChange={(e) => setEditFormData({ ...editFormData, interval_days: parseInt(e.target.value) || 0 })}
                                />
                              </div>
                              <div>
                                <Label>Last Performed</Label>
                                <Input
                                  type="date"
                                  value={editFormData.last_scheduled_date}
                                  onChange={(e) => setEditFormData({ ...editFormData, last_scheduled_date: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>Notes</Label>
                                <Input
                                  value={editFormData.notes}
                                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={handleSaveEdit}>Save</Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingSchedule(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">{SERVICE_TYPE_LABELS[schedule.service_type]}</Badge>
                                {isOverdue && (
                                  <Badge variant="destructive">{Math.abs(daysUntil)} days overdue</Badge>
                                )}
                                {isDueSoon && (
                                  <Badge className="bg-warning/10 text-warning">{daysUntil} days until due</Badge>
                                )}
                                {!isOverdue && !isDueSoon && daysUntil !== null && (
                                  <Badge variant="outline">Due in {daysUntil} days</Badge>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleEditSchedule(schedule)}
                                  title="Edit schedule"
                                >
                                  <Wrench className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleLogService(schedule)}
                                  title="Log service record"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteSchedule(schedule.id)}
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Every {schedule.interval_days} days • Next due: {format(parseISO(schedule.next_due_date), "MMM d, yyyy")}
                              {schedule.last_scheduled_date && ` • Last: ${format(parseISO(schedule.last_scheduled_date), "MMM d, yyyy")}`}
                            </div>
                            {schedule.notes && (
                              <div className="text-xs text-muted-foreground mt-1">{schedule.notes}</div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}