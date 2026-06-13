import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useCateringEvents } from "@/hooks/useCateringEvents";
import { computeProgress, eventTimeLabel } from "@/lib/catering";
import EventEditorDialog from "@/components/catering/EventEditorDialog";
import EventDetail from "@/components/catering/EventDetail";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Plus, MapPin, Users, Calendar, Pencil, Trash2, PartyPopper } from "lucide-react";
import { toast } from "sonner";

const STATUS_VARIANT = {
  upcoming: "default",
  completed: "secondary",
  cancelled: "destructive",
};

export default function DashboardCatering() {
  const { user } = useAuth();
  const { events, crewByEvent, checklistByEvent, packingByEvent, refetchEvents } =
    useCateringEvents();

  const { data: allUsers = [] } = useQuery({
    queryKey: ["company-users"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyUsers", {});
      return res.data?.users || [];
    },
  });

  const [tab, setTab] = useState("upcoming");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openEventId, setOpenEventId] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const byStatus = useMemo(() => {
    const groups = { upcoming: [], completed: [], cancelled: [] };
    for (const ev of events) (groups[ev.status] || groups.upcoming).push(ev);
    const byDate = (a, b) =>
      new Date(a.event_date || 0) - new Date(b.event_date || 0);
    groups.upcoming.sort(byDate);
    groups.completed.sort((a, b) => -byDate(a, b));
    groups.cancelled.sort((a, b) => -byDate(a, b));
    return groups;
  }, [events]);

  const openEvent = events.find((e) => e.id === openEventId) || null;

  const startCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const startEdit = (ev) => {
    setEditing(ev);
    setEditorOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      // Remove child rows first so nothing is orphaned.
      const [crew, checklist, packing] = await Promise.all([
        base44.entities.CateringCrew.filter({ event_id: deleting.id }),
        base44.entities.CateringChecklistItem.filter({ event_id: deleting.id }),
        base44.entities.CateringPackingItem.filter({ event_id: deleting.id }),
      ]);
      await Promise.all([
        ...crew.map((c) => base44.entities.CateringCrew.delete(c.id)),
        ...checklist.map((c) => base44.entities.CateringChecklistItem.delete(c.id)),
        ...packing.map((p) => base44.entities.CateringPackingItem.delete(p.id)),
      ]);
      await base44.entities.CateringEvent.delete(deleting.id);
      toast.success("Event deleted");
      if (openEventId === deleting.id) setOpenEventId(null);
      setDeleting(null);
      refetchEvents();
    } catch (e) {
      toast.error(e.message || "Could not delete event");
    }
  };

  const renderCard = (ev) => {
    const crew = crewByEvent[ev.id] || [];
    const progress = computeProgress(
      checklistByEvent[ev.id] || [],
      packingByEvent[ev.id] || []
    );
    return (
      <Card
        key={ev.id}
        className="cursor-pointer transition-colors hover:border-primary/50"
        onClick={() => setOpenEventId(ev.id)}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold truncate">{ev.event_name}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Calendar className="h-3 w-3" />
                {eventTimeLabel(ev)}
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[ev.status] || "default"}>{ev.status}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {ev.event_location && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3" />
                {ev.event_location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {crew.length} crew
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Progress value={progress.percent} className="h-1.5 flex-1" />
            <span className="text-[11px] text-muted-foreground shrink-0">
              {progress.total === 0 ? "No tasks" : `${progress.percent}%`}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderList = (list) =>
    list.length === 0 ? (
      <div className="text-center py-12 text-muted-foreground">
        <PartyPopper className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No {tab} events.</p>
      </div>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(renderCard)}</div>
    );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Catering Events</h1>
          <p className="text-sm text-muted-foreground">
            Plan events, assign crew, and track prep, on-site, and wrap-up checklists.
          </p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Event
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upcoming">
            Upcoming ({byStatus.upcoming.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({byStatus.completed.length})
          </TabsTrigger>
          <TabsTrigger value="cancelled">
            Cancelled ({byStatus.cancelled.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4">
          {renderList(byStatus.upcoming)}
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          {renderList(byStatus.completed)}
        </TabsContent>
        <TabsContent value="cancelled" className="mt-4">
          {renderList(byStatus.cancelled)}
        </TabsContent>
      </Tabs>

      <EventEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        event={editing}
        onSaved={() => refetchEvents()}
      />

      <Sheet open={!!openEvent} onOpenChange={(o) => !o && setOpenEventId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {openEvent && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center justify-between gap-2 pr-6">
                  <span className="truncate">{openEvent.event_name}</span>
                </SheetTitle>
              </SheetHeader>
              <div className="flex gap-2 mt-3 mb-5">
                <Button size="sm" variant="outline" onClick={() => startEdit(openEvent)}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleting(openEvent)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </div>
              <EventDetail
                event={openEvent}
                manage
                allUsers={allUsers}
                currentUserEmail={user?.email}
              />
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.event_name}” and all of its crew assignments, checklists, and
              packing items will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
