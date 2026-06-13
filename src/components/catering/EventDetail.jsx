import { useCateringEvent } from "@/hooks/useCateringEvent";
import { CHECKLIST_PHASES, computeProgress, eventTimeLabel } from "@/lib/catering";
import ChecklistSection from "@/components/catering/ChecklistSection";
import PackingSection from "@/components/catering/PackingSection";
import MemberPicker from "@/components/shared/MemberPicker";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users } from "lucide-react";

// The full working view of one event. `manage` (managers) unlocks crew editing
// and task/packing authoring; without it crew can still check items off in the
// field. `phases` restricts which checklist phases render (mobile arrival/wrap-up).
export default function EventDetail({
  event,
  manage = false,
  allUsers = [],
  phases = CHECKLIST_PHASES,
  showPacking = true,
  currentUserEmail,
}) {
  const {
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
  } = useCateringEvent(event.id);

  const progress = computeProgress(checklist, packing);
  const selectedEmails = crew.map((c) => c.user_email);

  const onCrewChange = (updater) => {
    const next = updater(selectedEmails);
    // Added emails
    for (const email of next) {
      if (!selectedEmails.includes(email)) {
        const u = allUsers.find((x) => x.email === email);
        addCrew({ user_email: email, user_name: u?.full_name || email });
      }
    }
    // Removed emails
    for (const member of crew) {
      if (!next.includes(member.user_email)) removeCrew(member);
    }
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{eventTimeLabel(event)}</span>
          {event.event_location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {event.event_location}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {crew.length} assigned
          </span>
        </div>
        {event.event_notes && (
          <p className="text-sm whitespace-pre-wrap">{event.event_notes}</p>
        )}
        <div className="flex items-center gap-2">
          <Progress value={progress.percent} className="h-2 flex-1" />
          <span className="text-xs text-muted-foreground shrink-0">
            {progress.done}/{progress.total}
          </span>
        </div>
      </div>

      {/* Crew */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Crew</h4>
        {manage ? (
          <MemberPicker
            allUsers={allUsers}
            selected={selectedEmails}
            onChange={onCrewChange}
            currentUserEmail={null}
            placeholder="Search staff to assign..."
          />
        ) : crew.length === 0 ? (
          <p className="text-xs text-muted-foreground">No crew assigned.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {crew.map((c) => (
              <Badge key={c.id} variant="secondary">
                {c.user_name || c.user_email}
                {c.user_email === currentUserEmail && " (you)"}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Checklist phases */}
      {phases.map((phase) => (
        <ChecklistSection
          key={phase.key}
          phase={phase}
          items={checklist.filter((c) => c.phase_type === phase.key)}
          manage={manage}
          onAdd={addChecklistItem}
          onToggle={toggleChecklistItem}
          onRemove={removeChecklistItem}
        />
      ))}

      {/* Packing list */}
      {showPacking && (
        <PackingSection
          items={packing}
          manage={manage}
          onAdd={addPackingItem}
          onToggle={togglePackingItem}
          onRemove={removePackingItem}
        />
      )}
    </div>
  );
}
