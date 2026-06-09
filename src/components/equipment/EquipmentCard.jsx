import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wrench, MapPin, Calendar, AlertTriangle, CheckCircle, Clock, Pencil } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";

const CATEGORY_LABELS = {
  espresso_machine: "Espresso Machine",
  grinder: "Grinder",
  brewer: "Brewer",
  refrigeration: "Refrigeration",
  dishwasher: "Dishwasher",
  other: "Other",
};

const STATUS_CONFIG = {
  overdue: { label: "Overdue", icon: AlertTriangle, className: "bg-destructive/10 text-destructive border-destructive/20" },
  due_soon: { label: "Due Soon", icon: Clock, className: "bg-warning/10 text-warning border-warning/20" },
  ok: { label: "Up to Date", icon: CheckCircle, className: "bg-success/10 text-success border-success/20" },
  unknown: { label: "No Schedule", icon: Clock, className: "bg-muted text-muted-foreground border-border" },
};

export default function EquipmentCard({ equipment, location, status, onEdit, onService }) {
  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;

  const daysUntil = equipment.next_service_date
    ? differenceInDays(parseISO(equipment.next_service_date), new Date())
    : null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-foreground">{equipment.name}</h3>
          {equipment.model && <p className="text-xs text-muted-foreground">{equipment.model}</p>}
        </div>
        <Badge variant="outline" className={cfg.className}>
          <StatusIcon className="w-3 h-3 mr-1" />
          {cfg.label}
        </Badge>
      </div>

      <div className="space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{CATEGORY_LABELS[equipment.category] || "Other"}</Badge>
        </div>
        {location && (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            {location.name}
          </div>
        )}
        {equipment.last_service_date && (
          <div className="flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" />
            Last serviced: {format(parseISO(equipment.last_service_date), "MMM d, yyyy")}
          </div>
        )}
        {equipment.next_service_date && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Next service: {format(parseISO(equipment.next_service_date), "MMM d, yyyy")}
            {daysUntil !== null && (
              <span className={daysUntil < 0 ? "text-destructive font-medium" : daysUntil <= 14 ? "text-warning font-medium" : ""}>
                ({daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? "today" : `in ${daysUntil}d`})
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-auto pt-2 border-t border-border">
        <Button size="sm" variant="outline" onClick={onEdit} className="flex-1">
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Edit
        </Button>
        <Button size="sm" onClick={onService} className="flex-1">
          <Wrench className="w-3.5 h-3.5 mr-1" />
          Log Service
        </Button>
      </div>
    </div>
  );
}