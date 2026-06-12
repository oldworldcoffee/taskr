import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { format } from "date-fns";
import { ArrowLeft, Clock, MapPin, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import ProgressBar from "@/components/shared/ProgressBar";
import UserAvatar from "@/components/shared/UserAvatar";
import TaskItem from "@/components/employee/TaskItem";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function ChecklistDetail() {
  const { instanceId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: instance } = useQuery({
    queryKey: ["instance", instanceId],
    queryFn: () => base44.entities.ChecklistInstance.filter({ id: instanceId }).then((r) => r[0]),
    enabled: !!instanceId,
  });

  const { data: checklist } = useQuery({
    queryKey: ["checklist", instance?.checklist_id],
    queryFn: () => base44.entities.Checklist.filter({ id: instance.checklist_id }).then((r) => r[0]),
    enabled: !!instance?.checklist_id,
  });

  const { data: location } = useQuery({
    queryKey: ["location", instance?.location_id],
    queryFn: () => base44.entities.Location.filter({ id: instance.location_id }).then((r) => r[0]),
    enabled: !!instance?.location_id,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", instance?.checklist_id],
    queryFn: () => base44.entities.Task.filter({ checklist_id: instance.checklist_id }),
    enabled: !!instance?.checklist_id,
  });

  const { data: taskGroups = [] } = useQuery({
    queryKey: ["taskGroups", instance?.checklist_id],
    queryFn: () => base44.entities.TaskGroup.filter({ checklist_id: instance.checklist_id }).then(groups => groups.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))),
    enabled: !!instance?.checklist_id,
  });

  const { data: completions = [], refetch: refetchCompletions } = useQuery({
    queryKey: ["completions", instanceId],
    queryFn: () => base44.entities.TaskCompletion.filter({ instance_id: instanceId }),
    enabled: !!instanceId,
  });

  // Real-time sync
  useEffect(() => {
    const getEventRecord = (event) => event.new || event.old || event.data || {};

    const unsub1 = base44.entities.TaskCompletion.subscribe((event) => {
      if (getEventRecord(event).instance_id === instanceId) {
        refetchCompletions();
      }
    });
    const unsub2 = base44.entities.ChecklistInstance.subscribe((event) => {
      if (getEventRecord(event).id === instanceId) {
        queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
      }
    });
    return () => { unsub1(); unsub2(); };
  }, [instanceId]);

  // Mark instance as in_progress if not_started
  useEffect(() => {
    if (instance && instance.status === "not_started") {
      base44.entities.ChecklistInstance.update(instance.id, {
        status: "in_progress",
        started_at: new Date().toISOString(),
        started_by: user.email,
        started_by_name: user.full_name || user.email,
      });
    }
  }, [instance?.id]);

  if (!instance || !checklist) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const completionMap = {};
  const flagMap = {};
  completions.forEach((c) => {
    if (c.is_flag) {
      flagMap[c.task_id] = c;
    } else {
      completionMap[c.task_id] = c;
    }
  });

  // Filter tasks by scheduled day
  const today = format(new Date(instance.date + "T12:00:00"), "EEEE").toLowerCase(); // e.g. "monday"
  const isTaskScheduledForToday = (task) => {
    if (!task.scheduled_days || task.scheduled_days.length === 0) return true;
    if (task.scheduled_days.includes("daily")) return true;
    return task.scheduled_days.includes(today);
  };

  // Group tasks by their group_id (filtered by day)
  const tasksByGroup = {};
  taskGroups.forEach(group => {
    tasksByGroup[group.id] = tasks
      .filter(t => t.group_id === group.id && !t.parent_task_id && isTaskScheduledForToday(t))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  });
  // Ungrouped tasks (filtered by day)
  const ungroupedTasks = tasks
    .filter(t => !t.group_id && !t.parent_task_id && isTaskScheduledForToday(t))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Only count tasks scheduled for this day
  const scheduledTasks = tasks.filter(isTaskScheduledForToday);
  const requiredTasks = scheduledTasks.filter((t) => t.is_required);
  // A required task is considered "done" if it has a completion OR a flag
  const allRequiredDone = requiredTasks.every((t) => completionMap[t.id] || flagMap[t.id]);
  const totalDone = Object.keys(completionMap).length;
  const totalTasks = scheduledTasks.length;
  const optionalRemaining = scheduledTasks.filter((t) => !t.is_required && !completionMap[t.id] && !flagMap[t.id]).length;

  const handleComplete = async (taskId, value) => {
    const completion = await base44.entities.TaskCompletion.create({
      instance_id: instanceId,
      task_id: taskId,
      company_id: user.company_id || instance?.company_id,
      completed_by_email: user.email,
      completed_by_name: user.full_name || user.email,
      completed_at: new Date().toISOString(),
      value,
    });

    queryClient.setQueryData(["completions", instanceId], (current = []) => {
      const alreadyCompleted = current.some((item) => !item.is_flag && item.task_id === taskId);
      if (alreadyCompleted) {
        return current.map((item) => (!item.is_flag && item.task_id === taskId ? completion : item));
      }
      return [...current, completion];
    });

    return completion;
  };

  const handleSubmit = async () => {
    if (optionalRemaining > 0 && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    setSubmitting(true);
    await base44.entities.ChecklistInstance.update(instance.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: user.email,
      completion_notes: optionalRemaining > 0 ? `Submitted with ${optionalRemaining} optional tasks remaining` : "",
    });
    setSubmitting(false);
    navigate("/checklists");
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div>
        <button onClick={() => navigate("/checklists")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="text-xl font-bold">{checklist.name}</h2>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {location && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {location.name}
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            {format(new Date(instance.date + "T12:00:00"), "MMM d, yyyy")}
          </span>
          {checklist.recommended_start_time && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {checklist.recommended_start_time}
            </span>
          )}
          <StatusBadge status={instance.status} />
        </div>
      </div>

      {/* Progress */}
      <ProgressBar completed={totalDone} total={totalTasks} />

      {/* Active Users */}
      {instance.active_users && instance.active_users.length > 0 && (
        <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-3">
          <span className="text-xs text-muted-foreground">Working on this:</span>
          <div className="flex gap-1">
            {instance.active_users.map((u, i) => (
              <UserAvatar key={i} name={u} size="xs" />
            ))}
          </div>
        </div>
      )}

      {/* Tasks grouped by TaskGroup */}
      <div className="space-y-6">
        {taskGroups.map((group) => (
          <div key={group.id}>
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wide mb-3 px-2">{group.name}</h3>
            <div className="space-y-3">
              {tasksByGroup[group.id]?.map((task) => {
                const subtasks = tasks.filter((t) => t.parent_task_id === task.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
                const subtaskCompletionMap = {};
                subtasks.forEach((st) => { if (completionMap[st.id]) subtaskCompletionMap[st.id] = completionMap[st.id]; });

                return (
                  <TaskItem
                    key={task.id}
                    task={task}
                    completion={completionMap[task.id]}
                    subtasks={subtasks}
                    subtaskCompletions={subtaskCompletionMap}
                    instanceId={instanceId}
                    locationId={instance?.location_id}
                    companyId={instance?.company_id}
                    user={user}
                    onComplete={handleComplete}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {/* Ungrouped tasks */}
        {ungroupedTasks.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-2">Other Tasks</h3>
            <div className="space-y-3">
              {ungroupedTasks.map((task) => {
                const subtasks = tasks.filter((t) => t.parent_task_id === task.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
                const subtaskCompletionMap = {};
                subtasks.forEach((st) => { if (completionMap[st.id]) subtaskCompletionMap[st.id] = completionMap[st.id]; });

                return (
                  <TaskItem
                    key={task.id}
                    task={task}
                    completion={completionMap[task.id]}
                    subtasks={subtasks}
                    subtaskCompletions={subtaskCompletionMap}
                    instanceId={instanceId}
                    locationId={instance?.location_id}
                    companyId={instance?.company_id}
                    user={user}
                    onComplete={handleComplete}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      {instance.status !== "completed" && (
        <div className="fixed bottom-20 left-0 right-0 p-4 bg-background/80 backdrop-blur-lg border-t border-border/50 max-w-lg mx-auto">
          <Button
            onClick={handleSubmit}
            disabled={!allRequiredDone || submitting}
            className="w-full h-14 text-base font-semibold rounded-xl"
            size="lg"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 mr-2" />
                Mark Complete
              </>
            )}
          </Button>
          {!allRequiredDone && (
            <p className="text-xs text-destructive text-center mt-2 flex items-center justify-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Complete all required tasks first
            </p>
          )}
        </div>
      )}

      {/* Confirm Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit with optional tasks remaining?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {optionalRemaining} optional task{optionalRemaining > 1 ? "s" : ""} still incomplete. Are you sure you want to submit?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit}>Submit Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
