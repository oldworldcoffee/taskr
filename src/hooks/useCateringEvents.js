import { useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";

// Loads every catering event for the company plus its crew, checklist and
// packing rows, grouped by event id so the dashboard can show crew counts and
// completion progress at a glance. Subscribes to all four tables for live updates.
export function useCateringEvents() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const companyId = user?.company_id;

  const { data: events = [], refetch: refetchEvents } = useQuery({
    queryKey: ["catering-events", companyId],
    queryFn: () => base44.entities.CateringEvent.filter({ company_id: companyId }),
    enabled: !!companyId,
  });

  const { data: crew = [] } = useQuery({
    queryKey: ["catering-crew", companyId],
    queryFn: () => base44.entities.CateringCrew.filter({ company_id: companyId }),
    enabled: !!companyId,
  });

  const { data: checklist = [] } = useQuery({
    queryKey: ["catering-checklist", companyId],
    queryFn: () =>
      base44.entities.CateringChecklistItem.filter({ company_id: companyId }),
    enabled: !!companyId,
  });

  const { data: packing = [] } = useQuery({
    queryKey: ["catering-packing", companyId],
    queryFn: () =>
      base44.entities.CateringPackingItem.filter({ company_id: companyId }),
    enabled: !!companyId,
  });

  useEffect(() => {
    const subs = [
      base44.entities.CateringEvent.subscribe(() =>
        queryClient.invalidateQueries({ queryKey: ["catering-events"] })
      ),
      base44.entities.CateringCrew.subscribe(() =>
        queryClient.invalidateQueries({ queryKey: ["catering-crew"] })
      ),
      base44.entities.CateringChecklistItem.subscribe(() =>
        queryClient.invalidateQueries({ queryKey: ["catering-checklist"] })
      ),
      base44.entities.CateringPackingItem.subscribe(() =>
        queryClient.invalidateQueries({ queryKey: ["catering-packing"] })
      ),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, [queryClient]);

  const crewByEvent = useMemo(() => groupBy(crew, "event_id"), [crew]);
  const checklistByEvent = useMemo(() => groupBy(checklist, "event_id"), [checklist]);
  const packingByEvent = useMemo(() => groupBy(packing, "event_id"), [packing]);

  return {
    events,
    crewByEvent,
    checklistByEvent,
    packingByEvent,
    refetchEvents,
  };
}

function groupBy(rows, key) {
  const map = {};
  for (const row of rows) {
    (map[row[key]] ||= []).push(row);
  }
  return map;
}
