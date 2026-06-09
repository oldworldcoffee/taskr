import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import StatusBadge from "@/components/shared/StatusBadge";
import ProgressBar from "@/components/shared/ProgressBar";
import { ExternalLink, Flag, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const shiftLabels = { opening: "Opening", mid_shift: "Mid-Shift", closing: "Closing" };

export default function InstanceTable({ instances, locations, tasks, completions, onClose }) {
  const getLocationName = (id) => locations.find((l) => l.id === id)?.name || "Unknown";

  const getScheduledDayForInstance = (inst) => {
    const d = new Date(inst.date + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  };

  const getTaskCount = (inst) => {
    const day = getScheduledDayForInstance(inst);
    const scheduledTasks = tasks.filter((t) => {
      if (t.checklist_id !== inst.checklist_id) return false;
      if (!t.scheduled_days || t.scheduled_days.length === 0) return true;
      if (t.scheduled_days.includes("daily")) return true;
      return t.scheduled_days.includes(day);
    });
    const total = scheduledTasks.length;
    const done = completions.filter((c) => c.instance_id === inst.id && !c.is_flag).length;
    return { total, done };
  };

  const getFlagCount = (instanceId) => completions.filter((c) => c.instance_id === instanceId && c.is_flag).length;

  if (instances.length === 0) {
    return <p className="text-center text-muted-foreground py-10">No checklists found for this selection.</p>;
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold">Location</TableHead>
            <TableHead className="font-semibold">Shift</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
            <TableHead className="font-semibold">Started By</TableHead>
            <TableHead className="font-semibold">Date</TableHead>
            <TableHead className="font-semibold">Started At</TableHead>
            <TableHead className="font-semibold">Completed At</TableHead>
            <TableHead className="font-semibold">Progress</TableHead>
            <TableHead className="font-semibold">Flags</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((inst) => {
            const { total, done } = getTaskCount(inst);
            const flags = getFlagCount(inst.id);
            return (
              <TableRow key={inst.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-medium">{getLocationName(inst.location_id)}</TableCell>
                <TableCell>{shiftLabels[inst.shift_type] || inst.shift_type}</TableCell>
                <TableCell><StatusBadge status={inst.status} /></TableCell>
                <TableCell className="text-sm">{inst.started_by_name || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {format(new Date(inst.date + "T12:00:00"), "MMM d, EEE")}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {inst.started_at ? format(new Date(inst.started_at), "h:mm a") : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {inst.completed_at ? format(new Date(inst.completed_at), "h:mm a") : "—"}
                </TableCell>
                <TableCell className="min-w-[140px]">
                  <ProgressBar completed={done} total={total} />
                </TableCell>
                <TableCell>
                  {flags > 0 && (
                    <span className="flex items-center gap-1 text-destructive text-sm font-medium">
                      <Flag className="h-3.5 w-3.5" /> {flags}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link to={`/dashboard/review/${inst.id}`} className="text-primary hover:text-primary/80">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    {inst.status !== "completed" && onClose && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive gap-1"
                        onClick={() => onClose(inst)}
                        title="Manually close checklist"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Close
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}