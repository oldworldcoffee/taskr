import { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";

// Focused loader for a single event's crew, checklist items and packing list,
// with the mutations the detail and mobile views need (add / toggle / remove).
// Subscribes so two crew members checking items off see each other live.
export function useCateringEvent(eventId) {
  const { user } = useAuth();

  const { data: crew = [], refetch: refetchCrew } = useQuery({
    queryKey: ["catering-event-crew", eventId],
    queryFn: () => base44.entities.CateringCrew.filter({ event_id: eventId }),
    enabled: !!eventId,
  });

  const { data: checklist = [], refetch: refetchChecklist } = useQuery({
    queryKey: ["catering-event-checklist", eventId],
    queryFn: () => base44.entities.CateringChecklistItem.filter({ event_id: eventId }),
    enabled: !!eventId,
  });

  const { data: packing = [], refetch: refetchPacking } = useQuery({
    queryKey: ["catering-event-packing", eventId],
    queryFn: () => base44.entities.CateringPackingItem.filter({ event_id: eventId }),
    enabled: !!eventId,
  });

  useEffect(() => {
    if (!eventId) return undefined;
    const subs = [
      base44.entities.CateringChecklistItem.subscribe(() => refetchChecklist()),
      base44.entities.CateringPackingItem.subscribe(() => refetchPacking()),
      base44.entities.CateringCrew.subscribe(() => refetchCrew()),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, [eventId, refetchChecklist, refetchPacking, refetchCrew]);

  const addChecklistItem = async ({ phase_type, task_name, due_before_event }) => {
    const siblings = checklist.filter((c) => c.phase_type === phase_type);
    const nextOrder = siblings.reduce((m, c) => Math.max(m, c.task_order ?? -1), -1) + 1;
    await base44.entities.CateringChecklistItem.create({
      company_id: user.company_id,
      event_id: eventId,
      phase_type,
      task_name: task_name.trim(),
      due_before_event: due_before_event || null,
      task_order: nextOrder,
      completed: false,
    });
    refetchChecklist();
  };

  const toggleChecklistItem = async (item) => {
    const completing = !item.completed;
    await base44.entities.CateringChecklistItem.update(item.id, {
      completed: completing,
      completed_at: completing ? new Date().toISOString() : null,
      completed_by_email: completing ? user.email : null,
      completed_by_name: completing ? user.full_name || user.email : null,
    });
    refetchChecklist();
  };

  const removeChecklistItem = async (item) => {
    await base44.entities.CateringChecklistItem.delete(item.id);
    refetchChecklist();
  };

  const addPackingItem = async ({ item_name, quantity }) => {
    const nextOrder = packing.reduce((m, p) => Math.max(m, p.item_order ?? -1), -1) + 1;
    await base44.entities.CateringPackingItem.create({
      company_id: user.company_id,
      event_id: eventId,
      item_name: item_name.trim(),
      quantity: Number(quantity) || 1,
      item_order: nextOrder,
      checked: false,
    });
    refetchPacking();
  };

  const togglePackingItem = async (item) => {
    const checking = !item.checked;
    await base44.entities.CateringPackingItem.update(item.id, {
      checked: checking,
      checked_at: checking ? new Date().toISOString() : null,
      checked_by_email: checking ? user.email : null,
    });
    refetchPacking();
  };

  const removePackingItem = async (item) => {
    await base44.entities.CateringPackingItem.delete(item.id);
    refetchPacking();
  };

  const addCrew = async ({ user_email, user_name, crew_role }) => {
    if (crew.some((c) => c.user_email === user_email)) return;
    await base44.entities.CateringCrew.create({
      company_id: user.company_id,
      event_id: eventId,
      user_email,
      user_name,
      crew_role: crew_role || null,
      assigned_at: new Date().toISOString(),
    });
    refetchCrew();
  };

  const removeCrew = async (member) => {
    await base44.entities.CateringCrew.delete(member.id);
    refetchCrew();
  };

  return {
    crew,
    checklist,
    packing,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    addPackingItem,
    togglePackingItem,
    removePackingItem,
    addCrew,
    removeCrew,
    refetch: () => {
      refetchCrew();
      refetchChecklist();
      refetchPacking();
    },
  };
}
