import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { format, eachDayOfInterval, parseISO, startOfWeek, endOfWeek } from "date-fns";
import { CheckCircle2, Clock, Circle, AlertTriangle, UserCircle, DollarSign } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SummaryCard from "@/components/management/SummaryCard";
import InstanceTable from "@/components/management/InstanceTable";

export default function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateMode, setDateMode] = useState("range"); // "single" | "range"
  const [selectedDate, setSelectedDate] = useState(today);
  const [rangeStart, setRangeStart] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [rangeEnd, setRangeEnd] = useState(format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [closeTarget, setCloseTarget] = useState(null);

  // All dates in the active selection
  const activeDates = dateMode === "single"
    ? [selectedDate]
    : (() => {
        try {
          return eachDayOfInterval({ start: parseISO(rangeStart), end: parseISO(rangeEnd) }).map(d => format(d, "yyyy-MM-dd"));
        } catch { return [rangeStart]; }
      })();

  const handleClose = async () => {
    await base44.entities.ChecklistInstance.update(closeTarget.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: user?.email,
    });
    queryClient.invalidateQueries({ queryKey: ["instances", dateMode, selectedDate, rangeStart, rangeEnd] });
    setCloseTarget(null);
  };

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: user.company_id, is_active: true }),
  });

  const locationIds = locations.map(l => l.id);

  const { data: instances = [], refetch: refetchInstances } = useQuery({
    queryKey: ["instances", dateMode, selectedDate, rangeStart, rangeEnd, locationIds.join(",")],
    queryFn: async () => {
      const dates = activeDates.slice(0, 31);
      if (dates.length === 1) {
        return base44.entities.ChecklistInstance.filter({ company_id: user.company_id, date: dates[0] });
      }
      // Use $in to fetch all dates in a single request instead of parallel calls
      return base44.entities.ChecklistInstance.filter({ company_id: user.company_id, date: { $in: dates } });
    },
    enabled: !!user?.company_id && locations.length > 0,
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ["checklists", user?.company_id],
    queryFn: () => base44.entities.Checklist.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["all-tasks", checklists.map(c => c.id).join(",")],
    queryFn: () => base44.entities.Task.filter({ checklist_id: { $in: checklists.map(c => c.id) }, company_id: user.company_id }),
    enabled: checklists.length > 0,
  });

  const { data: completions = [], refetch: refetchCompletions } = useQuery({
    queryKey: ["all-completions", instances.map(i => i.id).join(",")],
    queryFn: async () => {
      if (instances.length === 0) return [];
      const ids = instances.map((i) => i.id);
      const allCompletions = await base44.entities.TaskCompletion.filter({ instance_id: { $in: ids } });
      return allCompletions.filter(c => !c.company_id || c.company_id === user.company_id);
    },
    enabled: instances.length > 0,
  });

  useEffect(() => {
    const unsub1 = base44.entities.ChecklistInstance.subscribe(() => refetchInstances());
    const unsub2 = base44.entities.TaskCompletion.subscribe(() => refetchCompletions());
    return () => { unsub1(); unsub2(); };
  }, []);

  // Filter by user's assigned locations if manager; super admins see all locations
  const assignedLocations = user?.assigned_locations || [];
  const visibleLocations = user?.role === "super_admin" || user?.role === "admin" || assignedLocations.length === 0
    ? locations
    : locations.filter((l) => assignedLocations.includes(l.id));

  const filteredInstances = selectedLocation === "all"
    ? instances.filter((i) => visibleLocations.some((l) => l.id === i.location_id))
    : instances.filter((i) => i.location_id === selectedLocation);

  const completed = filteredInstances.filter((i) => i.status === "completed").length;
  const inProgress = filteredInstances.filter((i) => i.status === "in_progress").length;
  const notStarted = filteredInstances.filter((i) => i.status === "not_started").length;
  const flagged = filteredInstances.filter((i) => i.status === "incomplete_flagged").length;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Operations Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor checklist compliance across all locations</p>
        </div>
        <div className="flex gap-2">
          <Link to="/dashboard/deposits">
            <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0">
              <DollarSign className="h-4 w-4" /> Deposit Reports
            </Button>
          </Link>
          <Link to="/home">
            <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0">
              <UserCircle className="h-4 w-4" /> Employee View
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Mode toggle */}
        <div className="flex rounded-md border border-input overflow-hidden">
          <button
            onClick={() => setDateMode("single")}
            className={`px-3 py-1.5 text-sm transition-colors ${dateMode === "single" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
          >
            Single Day
          </button>
          <button
            onClick={() => setDateMode("range")}
            className={`px-3 py-1.5 text-sm transition-colors ${dateMode === "range" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
          >
            Date Range
          </button>
        </div>

        {dateMode === "single" ? (
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-44"
          />
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="w-44"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="w-44"
            />
          </div>
        )}

        <Select value={selectedLocation} onValueChange={setSelectedLocation}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {visibleLocations.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard title="Completed" value={completed} icon={CheckCircle2} color="text-success" />
        <SummaryCard title="In Progress" value={inProgress} icon={Clock} color="text-warning" />
        <SummaryCard title="Not Started" value={notStarted} icon={Circle} color="text-muted-foreground" />
        <SummaryCard title="Flagged" value={flagged} icon={AlertTriangle} color="text-destructive" />
      </div>

      {/* Table */}
      <InstanceTable
        instances={filteredInstances}
        locations={locations}
        tasks={tasks}
        completions={completions}
        onClose={setCloseTarget}
      />

      <Dialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Manually Close Checklist</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will mark the checklist as <strong>completed</strong> regardless of task progress. Continue?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)}>Cancel</Button>
            <Button onClick={handleClose}>Close Checklist</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}