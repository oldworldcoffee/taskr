import { useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useCateringEvents } from "@/hooks/useCateringEvents";
import { computeProgress, eventTimeLabel, CHECKLIST_PHASES } from "@/lib/catering";
import EventDetail from "@/components/catering/EventDetail";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MapPin, Calendar, PartyPopper } from "lucide-react";

// Mobile view for crew: the events they're assigned to, with live check-off of
// every phase and the packing list. Read-only on authoring — items are added by
// managers on the dashboard — but check-off writes through immediately.
export default function MyCateringPage() {
  const { user } = useAuth();
  const { events, crewByEvent, checklistByEvent, packingByEvent } = useCateringEvents();

  const myEvents = useMemo(() => {
    return events
      .filter((ev) => ev.status !== "cancelled")
      .filter((ev) =>
        (crewByEvent[ev.id] || []).some((c) => c.user_email === user?.email)
      )
      .sort((a, b) => new Date(a.event_date || 0) - new Date(b.event_date || 0));
  }, [events, crewByEvent, user?.email]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">My Events</h1>
        <p className="text-sm text-muted-foreground">
          Events you're assigned to. Check tasks off as you go.
        </p>
      </div>

      {myEvents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <PartyPopper className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">You're not assigned to any events right now.</p>
        </div>
      ) : (
        <Accordion type="single" collapsible className="space-y-3">
          {myEvents.map((ev) => {
            const progress = computeProgress(
              checklistByEvent[ev.id] || [],
              packingByEvent[ev.id] || []
            );
            return (
              <AccordionItem
                key={ev.id}
                value={ev.id}
                className="border rounded-xl px-0 overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex-1 text-left space-y-1.5 pr-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold truncate">{ev.event_name}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {progress.total === 0 ? "—" : `${progress.percent}%`}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {eventTimeLabel(ev)}
                    </p>
                    {ev.event_location && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {ev.event_location}
                      </p>
                    )}
                    <Progress value={progress.percent} className="h-1.5" />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <EventDetail
                    event={ev}
                    manage={false}
                    phases={CHECKLIST_PHASES}
                    showPacking
                    currentUserEmail={user?.email}
                  />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
