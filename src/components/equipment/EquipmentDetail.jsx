import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Wrench, MapPin, Calendar, Clock, AlertTriangle, CheckCircle, Pencil, FileText } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { base44 } from "@/api/base44Client";

const CATEGORY_LABELS = {
  espresso_machine: "Espresso Machine",
  grinder: "Grinder",
  brewer: "Brewer",
  refrigeration: "Refrigeration",
  dishwasher: "Dishwasher",
  other: "Other",
};

const SERVICE_TYPE_LABELS = {
  routine_maintenance: "Routine Maintenance",
  cleaning: "Cleaning",
  repair: "Repair",
  inspection: "Inspection",
  burr_replacement: "Burr Replacement",
  calibration: "Calibration",
  other: "Other",
};

const STATUS_CONFIG = {
  overdue: { label: "Overdue", icon: AlertTriangle, className: "bg-destructive/10 text-destructive border-destructive/20" },
  due_soon: { label: "Due Soon", icon: Clock, className: "bg-warning/10 text-warning border-warning/20" },
  ok: { label: "Up to Date", icon: CheckCircle, className: "bg-success/10 text-success border-success/20" },
  unknown: { label: "No Schedule", icon: Clock, className: "bg-muted text-muted-foreground border-border" },
};

export default function EquipmentDetail({ equipment, location, serviceRecords, schedules = [], open, onClose, onEdit, onService, onSchedule }) {
  const status = (() => {
    if (!equipment.next_service_date) return "unknown";
    const days = differenceInDays(parseISO(equipment.next_service_date), new Date());
    if (days < 0) return "overdue";
    if (days <= 14) return "due_soon";
    return "ok";
  })();

  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;

  const daysUntil = equipment.next_service_date
    ? differenceInDays(parseISO(equipment.next_service_date), new Date())
    : null;

  // Determine recommended service type based on category and last service
  const getRecommendedServiceType = () => {
    const category = equipment.category;
    if (category === "espresso_machine" || category === "grinder") return "cleaning";
    if (category === "refrigeration") return "inspection";
    if (category === "dishwasher") return "cleaning";
    return "routine_maintenance";
  };

  const recommendedServiceType = getRecommendedServiceType();
  const hasSchedules = schedules && schedules.length > 0;

  const sortedRecords = [...serviceRecords].sort((a, b) => 
    new Date(b.service_date) - new Date(a.service_date)
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground" />
        <DialogHeader>
          <DialogTitle className="text-xl">{equipment.name}</DialogTitle>
          {equipment.model && <p className="text-sm text-muted-foreground">{equipment.model}</p>}
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {/* Equipment Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{CATEGORY_LABELS[equipment.category] || "Other"}</Badge>
                <Badge variant="outline" className={cfg.className}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {cfg.label}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {location && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-muted-foreground text-xs">Location</div>
                      <div className="font-medium">{location.name}</div>
                    </div>
                  </div>
                )}
                {equipment.serial_number && (
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-muted-foreground text-xs">Serial Number</div>
                      <div className="font-medium">{equipment.serial_number}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Next Service Required */}
              <div className="bg-muted/50 rounded-lg p-4 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-5 h-5 text-primary" />
                  <h4 className="font-semibold">Next Service Required</h4>
                </div>
                <div className="space-y-2">
                  {equipment.next_service_date ? (
                    <>
                      <div className="text-2xl font-bold">
                        {format(parseISO(equipment.next_service_date), "EEEE, MMMM d, yyyy")}
                      </div>
                      {daysUntil !== null && (
                        <div className={daysUntil < 0 ? "text-destructive font-medium" : daysUntil <= 14 ? "text-warning font-medium" : "text-muted-foreground"}>
                          {daysUntil < 0 
                            ? `${Math.abs(daysUntil)} days overdue` 
                            : daysUntil === 0 
                              ? "Due today" 
                              : `In ${daysUntil} days`}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <button
                          onClick={onService}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border border-transparent bg-primary/10 text-primary text-xs font-semibold transition-colors hover:bg-primary/20 focus:outline-none focus:ring-2 focus:ring-ring"
                          title="Log service"
                        >
                          <Wrench className="w-3 h-3" />
                          {SERVICE_TYPE_LABELS[recommendedServiceType]}
                        </button>
                        {equipment.service_interval_days && (
                          <div className="text-sm text-muted-foreground">
                            Service interval: Every {equipment.service_interval_days} days
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">No service schedule set</div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {hasSchedules && (
                      <Button size="sm" variant="outline" onClick={onSchedule} className="h-7 text-xs">
                        <Calendar className="w-3 h-3 mr-1" />
                        View Service Schedule
                      </Button>
                    )}
                    {!hasSchedules && (
                      <Button size="sm" variant="outline" onClick={onSchedule} className="h-7 text-xs">
                        <Calendar className="w-3 h-3 mr-1" />
                        Set Service Schedule
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Last Service */}
              {equipment.last_service_date && (
                <div className="flex items-center gap-2 text-sm">
                  <Wrench className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="text-muted-foreground text-xs">Last Serviced</div>
                    <div className="font-medium">{format(parseISO(equipment.last_service_date), "MMM d, yyyy")}</div>
                  </div>
                </div>
              )}

              {equipment.notes && (
                <div className="text-sm">
                  <div className="text-muted-foreground text-xs mb-1">Notes</div>
                  <div className="text-muted-foreground">{equipment.notes}</div>
                </div>
              )}
            </div>

            {/* Service Log */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Service Log
                </h4>
                <Button size="sm" variant="outline" onClick={onService}>
                  <Wrench className="w-3.5 h-3.5 mr-1" />
                  Log Service
                </Button>
              </div>

              {sortedRecords.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6 bg-muted/30 rounded-lg">
                  No service records yet
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedRecords.map((record) => (
                    <div key={record.id} className="border border-border rounded-lg p-3 bg-card">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-medium">{SERVICE_TYPE_LABELS[record.service_type] || record.service_type}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(parseISO(record.service_date), "MMM d, yyyy")}
                            {record.performed_by && ` • by ${record.performed_by}`}
                          </div>
                        </div>
                        {record.cost && (
                          <div className="text-sm font-medium">${record.cost.toFixed(2)}</div>
                        )}
                      </div>
                      {record.description && (
                        <div className="text-sm text-muted-foreground">{record.description}</div>
                      )}
                      {record.next_service_date && (
                        <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Next service: {format(parseISO(record.next_service_date), "MMM d, yyyy")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex gap-2 border-t pt-4">
          <Button variant="outline" onClick={onEdit} className="flex-1">
            <Pencil className="w-4 h-4 mr-2" />
            Edit Equipment
          </Button>
          <Button onClick={onService} className="flex-1">
            <Wrench className="w-4 h-4 mr-2" />
            Log Service
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}