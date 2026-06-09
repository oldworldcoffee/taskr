import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Flag, AlertTriangle, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/shared/StatusBadge";
import UserAvatar from "@/components/shared/UserAvatar";

export default function DashboardIssues() {
  const { user } = useAuth();
  const [dateFrom, setDateFrom] = useState(format(new Date(Date.now() - 7 * 86400000), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [locationFilter, setLocationFilter] = useState("all");

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: user.company_id, is_active: true }),
  });

  const { data: instances = [] } = useQuery({
    queryKey: ["flagged-instances", user.company_id],
    queryFn: () => base44.entities.ChecklistInstance.filter({ company_id: user.company_id }),
  });

  const { data: flags = [] } = useQuery({
    queryKey: ["flags", user.company_id],
    queryFn: async () => {
      return base44.entities.TaskCompletion.filter({ is_flag: true, company_id: user.company_id });
    },
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["all-tasks-issues", user.company_id],
    queryFn: () => base44.entities.Task.filter({ company_id: user.company_id }),
  });

  // Filter instances
  const filteredInstances = instances.filter((i) => {
    if (i.date < dateFrom || i.date > dateTo) return false;
    if (locationFilter !== "all" && i.location_id !== locationFilter) return false;
    return i.status === "incomplete_flagged" || i.status === "not_started";
  });

  // Filter flags to only those whose instance falls within the date/location filter
  const filteredInstanceIds = new Set(
    instances
      .filter((i) => {
        if (i.date < dateFrom || i.date > dateTo) return false;
        if (locationFilter !== "all" && i.location_id !== locationFilter) return false;
        return true;
      })
      .map((i) => i.id)
  );
  const filteredFlags = flags.filter((f) => filteredInstanceIds.has(f.instance_id));

  const getLocationName = (id) => locations.find((l) => l.id === id)?.name || "Unknown";
  const getTaskName = (id) => tasks.find((t) => t.id === id)?.title || "Unknown Task";

  const handleExport = () => {
    const rows = [["Date", "Location", "Task", "Flag Note", "Flagged By", "Time"]];
    filteredFlags.forEach((f) => {
      const inst = instances.find((i) => i.id === f.instance_id);
      rows.push([
        inst?.date || "",
        inst ? getLocationName(inst.location_id) : "",
        getTaskName(f.task_id),
        f.notes || "",
        f.completed_by_name || "",
        f.completed_at ? format(new Date(f.completed_at), "h:mm a") : "",
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `owcr-issues-${dateFrom}-to-${dateTo}.csv`;
    a.click();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Issues & Flags</h1>
          <p className="text-sm text-muted-foreground mt-1">Review flagged tasks and incomplete checklists</p>
        </div>
        <Button variant="outline" onClick={handleExport}>Export CSV</Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-44" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-44" />
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Flagged Tasks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Flag className="h-4 w-4 text-destructive" /> Flagged Tasks ({filteredFlags.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredFlags.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No flagged tasks found.</p>}
          {filteredFlags.map((f) => {
            const inst = instances.find((i) => i.id === f.instance_id);
            return (
              <Link key={f.id} to={inst ? `/dashboard/review/${inst.id}` : "#"} className="block">
                <div className="bg-destructive/5 rounded-lg p-4 hover:bg-destructive/10 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{getTaskName(f.task_id)}</p>
                      <p className="text-sm text-muted-foreground mt-1">{f.notes}</p>
                    </div>
                    {inst && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {getLocationName(inst.location_id)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <UserAvatar name={f.completed_by_name} size="xs" />
                    <span className="text-xs text-muted-foreground">
                      {f.completed_by_name} · {f.completed_at && format(new Date(f.completed_at), "MMM d, h:mm a")}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      {/* Incomplete Checklists */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> Incomplete / Not Started ({filteredInstances.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredInstances.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No issues found.</p>}
          {filteredInstances.map((inst) => (
            <Link key={inst.id} to={`/dashboard/review/${inst.id}`} className="block">
              <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{getLocationName(inst.location_id)}</span>
                  <span className="text-xs text-muted-foreground">{inst.date}</span>
                </div>
                <StatusBadge status={inst.status} />
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}