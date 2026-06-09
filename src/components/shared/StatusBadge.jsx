import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, AlertTriangle, Circle } from "lucide-react";

const statusConfig = {
  not_started: { label: "Not Started", icon: Circle, className: "bg-muted text-muted-foreground border-border" },
  in_progress: { label: "In Progress", icon: Clock, className: "bg-warning/15 text-warning border-warning/30" },
  completed: { label: "Completed", icon: CheckCircle2, className: "bg-success/15 text-success border-success/30" },
  incomplete_flagged: { label: "Flagged", icon: AlertTriangle, className: "bg-destructive/15 text-destructive border-destructive/30" },
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.not_started;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`${config.className} gap-1.5 font-medium px-2.5 py-1`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}