import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { format } from "date-fns";
import { Calendar, MapPin, ChevronDown, ChevronUp } from "lucide-react";
import ChecklistCard from "@/components/employee/ChecklistCard";
import { Skeleton } from "@/components/ui/skeleton";

export default function EmployeeHome() {
  const { user } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");
  const [expandedLocations, setExpandedLocations] = useState({});

  // Get user's assigned locations
  const assignedLocations = user?.assigned_locations || [];

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: user.company_id, is_active: true }),
  });

  // Filter to user's assigned locations or show all if none assigned
  const userLocations = assignedLocations.length > 0
    ? locations.filter((l) => assignedLocations.includes(l.id))
    : locations;

  const locationIds = userLocations.map((l) => l.id);

  const { data: checklists = [] } = useQuery({
    queryKey: ["checklists"],
    queryFn: () => base44.entities.Checklist.filter({ company_id: user.company_id, is_active: true }),
  });

  const { data: instances = [], refetch: refetchInstances } = useQuery({
    queryKey: ["instances", today, locationIds.join(",")],
    queryFn: () => base44.entities.ChecklistInstance.filter({ date: today, company_id: user.company_id, location_id: { $in: locationIds } }),
    enabled: !!user?.company_id && locationIds.length > 0,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => base44.entities.Task.filter({ checklist_id: { $in: checklists.map(c => c.id) } }),
    enabled: !!user?.company_id,
  });

  const { data: completions = [], refetch: refetchCompletions } = useQuery({
    queryKey: ["completions-today", instances.map(i => i.id).join(",")],
    queryFn: async () => {
      const todayInstances = instances.map((i) => i.id);
      if (todayInstances.length === 0) return [];
      return base44.entities.TaskCompletion.filter({ instance_id: { $in: todayInstances } });
    },
    enabled: instances.length > 0,
  });

  // Subscribe to real-time updates
  useEffect(() => {
    const unsub1 = base44.entities.ChecklistInstance.subscribe(() => refetchInstances());
    const unsub2 = base44.entities.TaskCompletion.subscribe(() => refetchCompletions());
    return () => { unsub1(); unsub2(); };
  }, []);

  // Filter checklists to user's locations
  const filteredChecklists = checklists.filter((c) =>
    locationIds.length === 0 || locationIds.includes(c.location_id)
  );

  // Group by location
  const grouped = userLocations.map((loc) => ({
    location: loc,
    checklists: filteredChecklists.filter((c) => c.location_id === loc.id),
  }));

  const toggleLocation = (locationId) => {
    setExpandedLocations(prev => ({
      ...prev,
      [locationId]: !prev[locationId]
    }));
  };

  return (
    <div className="space-y-6">
      {/* Date Header */}
      <div>
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Calendar className="h-4 w-4" />
          <span className="text-sm font-medium">{format(new Date(), "EEEE, MMMM d, yyyy")}</span>
        </div>
        <h2 className="text-2xl font-bold">Today's Checklists</h2>
      </div>

      {grouped.length === 0 && (
        <div className="text-center py-16">
          <MapPin className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">No locations assigned yet.</p>
          <p className="text-sm text-muted-foreground/70">Ask your manager to assign you to a location.</p>
        </div>
      )}

      {grouped.map(({ location, checklists: locChecklists }) => {
        const isExpanded = expandedLocations[location.id] !== false; // Default to expanded
        return (
          <div key={location.id} className="mb-6">
            <button
              onClick={() => toggleLocation(location.id)}
              className="w-full flex items-center gap-2 mb-3 hover:bg-muted/50 rounded-lg p-2 -ml-2 transition-colors"
            >
              <MapPin className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm text-primary flex-1 text-left">{location.name}</h3>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {isExpanded && (
              <div className="space-y-3">
                {locChecklists.length === 0 && (
                  <p className="text-sm text-muted-foreground pl-6">No checklists for this location.</p>
                )}
                {locChecklists.map((cl) => {
              const instance = instances.find(
                (i) => i.checklist_id === cl.id && i.location_id === cl.location_id && i.date === today
              );
              const clTasks = tasks.filter((t) => t.checklist_id === cl.id && !t.parent_task_id);
              const clCompletions = instance
                ? completions.filter((c) => c.instance_id === instance.id && !c.is_flag)
                : [];

              return (
                <ChecklistCard
                  key={cl.id}
                  checklist={cl}
                  instance={instance}
                  tasks={clTasks}
                  completions={clCompletions}
                  activeUsers={instance?.active_users || []}
                />
              );
            })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}