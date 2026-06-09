import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, ChevronRight } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import ProgressBar from "@/components/shared/ProgressBar";
import UserAvatar from "@/components/shared/UserAvatar";

export default function ChecklistCard({ checklist, instance, tasks, completions, activeUsers }) {
  const totalTasks = tasks.length;
  const completedTasks = completions.length;
  const status = instance?.status || "not_started";
  const instanceId = instance?.id;

  const shiftLabels = {
    opening: "Opening",
    mid_shift: "Mid-Shift",
    closing: "Closing",
  };

  return (
    <Link to={instanceId ? `/checklist/${instanceId}` : `/checklist/new/${checklist.id}`}>
      <Card className="group hover:shadow-lg transition-all duration-300 border-border/60 active:scale-[0.98]">
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors">
                {checklist.name}
              </h3>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-sm font-medium text-primary/80">
                  {shiftLabels[checklist.shift_type]}
                </span>
                {checklist.recommended_start_time && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {checklist.recommended_start_time}
                  </span>
                )}
                {checklist.expected_duration_minutes && (
                  <span className="text-xs text-muted-foreground">
                    ~{checklist.expected_duration_minutes} min
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
          </div>

          <ProgressBar completed={completedTasks} total={totalTasks} className="mb-3" />

          <div className="flex items-center justify-between">
            <StatusBadge status={status} />
            {activeUsers && activeUsers.length > 0 && (
              <div className="flex items-center gap-1">
                {activeUsers.slice(0, 3).map((u, i) => (
                  <UserAvatar key={i} name={u} size="xs" />
                ))}
                {activeUsers.length > 3 && (
                  <span className="text-xs text-muted-foreground ml-1">+{activeUsers.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}