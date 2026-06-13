import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { EVENT_STATUSES } from "@/lib/catering";

// Converts a stored ISO timestamp into the value a datetime-local input wants
// (local time, no timezone suffix). Returns "" when there's no date.
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const empty = { event_name: "", event_date: "", event_location: "", event_notes: "" };

export default function EventEditorDialog({ open, onOpenChange, event, onSaved }) {
  const { user } = useAuth();
  const [draft, setDraft] = useState(empty);
  const [status, setStatus] = useState("upcoming");
  const [saving, setSaving] = useState(false);
  const editing = !!event;

  useEffect(() => {
    if (event) {
      setDraft({
        event_name: event.event_name || "",
        event_date: toLocalInput(event.event_date),
        event_location: event.event_location || "",
        event_notes: event.event_notes || "",
      });
      setStatus(event.status || "upcoming");
    } else {
      setDraft(empty);
      setStatus("upcoming");
    }
  }, [event, open]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const save = async () => {
    if (!draft.event_name.trim()) {
      toast.error("Give the event a name.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: user.company_id,
        event_name: draft.event_name.trim(),
        event_date: draft.event_date ? new Date(draft.event_date).toISOString() : null,
        event_location: draft.event_location.trim() || null,
        event_notes: draft.event_notes.trim() || null,
        status,
      };
      let saved;
      if (editing) {
        saved = await base44.entities.CateringEvent.update(event.id, payload);
      } else {
        saved = await base44.entities.CateringEvent.create({
          ...payload,
          created_by_email: user.email,
          created_by_name: user.full_name || user.email,
        });
      }
      toast.success(editing ? "Event updated" : "Event created");
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message || "Could not save event");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Event" : "New Catering Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Event name</Label>
            <Input
              value={draft.event_name}
              onChange={set("event_name")}
              placeholder="e.g. Smith Wedding Reception"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date &amp; time</Label>
            <Input
              type="datetime-local"
              value={draft.event_date}
              onChange={set("event_date")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input
              value={draft.event_location}
              onChange={set("event_location")}
              placeholder="Venue / address"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={draft.event_notes}
              onChange={set("event_notes")}
              placeholder="Headcount, menu, access details, parking..."
              rows={3}
            />
          </div>
          {editing && (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
