import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, MapPin, Clock, Flag, AlertCircle, Camera, FileText, CheckSquare, Square, CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "@/components/shared/StatusBadge";
import UserAvatar from "@/components/shared/UserAvatar";

const typeIcons = { checkbox: CheckSquare, text_input: FileText, photo_upload: Camera };

export default function ChecklistReview() {
  const { instanceId } = useParams();
  const navigate = useNavigate();

  const { data: instance } = useQuery({
    queryKey: ["review-instance", instanceId],
    queryFn: () => base44.entities.ChecklistInstance.filter({ id: instanceId }).then((r) => r[0]),
  });

  const { data: checklist } = useQuery({
    queryKey: ["review-checklist", instance?.checklist_id],
    queryFn: () => base44.entities.Checklist.filter({ id: instance.checklist_id }).then((r) => r[0]),
    enabled: !!instance?.checklist_id,
  });

  const { data: location } = useQuery({
    queryKey: ["review-location", instance?.location_id],
    queryFn: () => base44.entities.Location.filter({ id: instance.location_id }).then((r) => r[0]),
    enabled: !!instance?.location_id,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["review-tasks", instance?.checklist_id],
    queryFn: () => base44.entities.Task.filter({ checklist_id: instance.checklist_id }),
    enabled: !!instance?.checklist_id,
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["review-completions-only", instanceId],
    queryFn: () => base44.entities.TaskCompletion.filter({ instance_id: instanceId }),
    enabled: !!instanceId,
    staleTime: 0,
  });

  if (!instance || !checklist) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const completionMap = {};
  const flags = [];
  // Explicitly filter to only this instance's completions in case the query returns extras
  const instanceCompletions = completions.filter(c => c.instance_id === instanceId);
  instanceCompletions.forEach((c) => {
    if (c.is_flag) flags.push(c);
    else completionMap[c.task_id] = c;
  });

  // Only show tasks scheduled for the instance's day
  const instanceDay = new Date(instance.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const isScheduled = (task) => {
    if (!task.scheduled_days || task.scheduled_days.length === 0) return true;
    if (task.scheduled_days.includes("daily")) return true;
    return task.scheduled_days.includes(instanceDay);
  };

  const topLevelTasks = tasks.filter((t) => !t.parent_task_id && isScheduled(t)).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  return (
    <div className="max-w-4xl space-y-6">
      <button onClick={() => navigate("/dashboard")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>

      {/* Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold">{checklist.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                {location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {location.name}</span>}
                <span>{format(new Date(instance.date), "MMM d, yyyy")}</span>
                {instance.started_at && (
                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Started {format(new Date(instance.started_at), "h:mm a")}</span>
                )}
                {instance.completed_at && (
                  <span>Completed {format(new Date(instance.completed_at), "h:mm a")}</span>
                )}
              </div>
            </div>
            <StatusBadge status={instance.status} />
          </div>
          {instance.started_by_name && (
            <div className="mt-3 flex items-center gap-2">
              <UserAvatar name={instance.started_by_name} size="xs" />
              <span className="text-sm text-muted-foreground">Started by {instance.started_by_name}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flags */}
      {flags.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <Flag className="h-4 w-4" /> Flagged Issues ({flags.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {flags.map((f) => {
              const task = tasks.find((t) => t.id === f.task_id);
              return (
                <div key={f.id} className="bg-destructive/5 rounded-lg p-3">
                  <p className="font-medium text-sm">{task?.title || "Unknown Task"}</p>
                  <p className="text-sm text-muted-foreground mt-1">{f.notes}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <UserAvatar name={f.completed_by_name} size="xs" />
                    <span className="text-xs text-muted-foreground">
                      {f.completed_by_name} · {format(new Date(f.completed_at), "h:mm a")}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Task Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Task Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border/50">
          {topLevelTasks.map((task) => {
            const comp = completionMap[task.id];
            const isMissedRequired = task.is_required && !comp;
            const TypeIcon = comp
              ? (task.task_type === "photo_upload" ? Camera : task.task_type === "text_input" ? FileText : CheckSquare)
              : (task.task_type === "photo_upload" ? Camera : task.task_type === "text_input" ? FileText : Square);
            const subTasks = tasks.filter((t) => t.parent_task_id === task.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

            return (
              <div key={task.id} className={`py-4 ${isMissedRequired ? "bg-destructive/5 -mx-6 px-6 rounded-lg" : ""}`}>
                <div className="flex items-start gap-3">
                  <TypeIcon className={`h-4 w-4 mt-0.5 ${comp ? "text-success" : isMissedRequired ? "text-destructive" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium text-sm ${comp ? "" : isMissedRequired ? "text-destructive" : "text-muted-foreground"}`}>
                        {task.title}
                      </span>
                      {task.is_required && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Required</Badge>}
                      {isMissedRequired && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                    </div>
                    {comp && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <UserAvatar name={comp.completed_by_name} size="xs" />
                        <span className="text-xs text-muted-foreground">
                          {comp.completed_by_name} · {format(new Date(comp.completed_at), "h:mm a")}
                        </span>
                      </div>
                    )}
                    {comp && task.task_type === "text_input" && comp.value && (
                      <p className="mt-1 text-sm bg-muted/50 rounded-lg px-3 py-2 inline-block">{comp.value}</p>
                    )}
                    {comp && task.task_type === "photo_upload" && comp.value && (
                      <img src={comp.value} alt="Upload" className="mt-2 rounded-lg h-32 object-cover" />
                    )}

                    {/* Subtasks */}
                    {subTasks.length > 0 && (
                      <div className="mt-3 ml-2 border-l-2 border-border pl-4 space-y-3">
                        {subTasks.map((st) => {
                          const stComp = completionMap[st.id];
                          const stMissed = st.is_required && !stComp;
                          return (
                            <div key={st.id} className={stMissed ? "text-destructive" : ""}>
                              <span className={`text-sm ${stComp ? "" : stMissed ? "text-destructive" : "text-muted-foreground"}`}>
                                {st.title}
                              </span>
                              {stComp && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  — {stComp.completed_by_name} · {format(new Date(stComp.completed_at), "h:mm a")}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}