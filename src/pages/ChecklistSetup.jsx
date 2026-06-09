import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MapPin, ClipboardList, ChevronRight, Pencil, Trash2, FileSpreadsheet, Copy, Merge } from "lucide-react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function ChecklistSetup() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [clDialog, setClDialog] = useState(false);
  const [clName, setClName] = useState("");
  const [clLocationId, setClLocationId] = useState("");
  const [clShift, setClShift] = useState("opening");

  // Rename checklist
  const [renameDialog, setRenameDialog] = useState(false);
  const [renamingCl, setRenamingCl] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Delete checklist
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deletingCl, setDeletingCl] = useState(null);

  // Duplicate checklist
  const [duplicateDialog, setDuplicateDialog] = useState(false);
  const [duplicatingCl, setDuplicatingCl] = useState(null);
  const [dupLocationId, setDupLocationId] = useState("");

  // Merge checklist
  const [mergeDialog, setMergeDialog] = useState(false);
  const [mergeTargetCl, setMergeTargetCl] = useState(null); // checklist to merge INTO
  const [mergeSourceId, setMergeSourceId] = useState("");

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const allLocations = await base44.entities.Location.filter({ company_id: user.company_id });
      // Filter by assigned_locations for non-admin users
      if (user.role !== "admin" && user.assigned_locations && user.assigned_locations.length > 0) {
        return allLocations.filter(loc => user.assigned_locations.includes(loc.id));
      }
      return allLocations;
    },
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ["checklists"],
    queryFn: async () => {
      const allChecklists = await base44.entities.Checklist.filter({ company_id: user.company_id });
      // Filter by assigned_locations for non-admin users
      if (user.role !== "admin" && user.assigned_locations && user.assigned_locations.length > 0) {
        return allChecklists.filter(cl => user.assigned_locations.includes(cl.location_id));
      }
      return allChecklists;
    },
  });

  const addChecklist = async () => {
    if (!clName.trim() || !clLocationId) return;
    await base44.entities.Checklist.create({
      name: clName.trim(),
      company_id: user.company_id,
      location_id: clLocationId,
      shift_type: clShift,
      is_active: true,
    });
    queryClient.invalidateQueries({ queryKey: ["checklists"] });
    setClDialog(false);
    setClName("");
    setClLocationId("");
    toast.success("Checklist added");
  };

  const openRename = (cl) => {
    setRenamingCl(cl);
    setRenameValue(cl.name);
    setRenameDialog(true);
  };

  const handleRename = async () => {
    if (!renameValue.trim() || !renamingCl) return;
    await base44.entities.Checklist.update(renamingCl.id, { name: renameValue.trim() });
    queryClient.invalidateQueries({ queryKey: ["checklists"] });
    setRenameDialog(false);
    setRenamingCl(null);
    toast.success("Checklist renamed");
  };

  const openDelete = (cl) => {
    setDeletingCl(cl);
    setDeleteDialog(true);
  };

  const handleDelete = async () => {
    if (!deletingCl) return;
    const tasks = await base44.entities.Task.filter({ checklist_id: deletingCl.id });
    await Promise.all(tasks.map(t => base44.entities.Task.delete(t.id)));
    await base44.entities.Checklist.delete(deletingCl.id);
    queryClient.invalidateQueries({ queryKey: ["checklists"] });
    setDeleteDialog(false);
    setDeletingCl(null);
    toast.success("Checklist deleted");
  };

  const openDuplicate = (cl) => {
    setDuplicatingCl(cl);
    setDupLocationId(cl.location_id);
    setDuplicateDialog(true);
  };

  const handleDuplicate = async () => {
    if (!duplicatingCl || !dupLocationId) return;
    const [groups, tasks] = await Promise.all([
      base44.entities.TaskGroup.filter({ checklist_id: duplicatingCl.id }),
      base44.entities.Task.filter({ checklist_id: duplicatingCl.id }),
    ]);
    const newChecklist = await base44.entities.Checklist.create({
      name: `${duplicatingCl.name} (Copy)`,
      company_id: user.company_id,
      location_id: dupLocationId,
      shift_type: duplicatingCl.shift_type,
      is_active: true,
    });
    const groupMap = {};
    if (groups.length > 0) {
      const newGroups = await base44.entities.TaskGroup.bulkCreate(
        groups.map(g => ({ checklist_id: newChecklist.id, company_id: user.company_id, name: g.name, sort_order: g.sort_order }))
      );
      groups.forEach((g, i) => { groupMap[g.id] = newGroups[i].id; });
    }
    const topLevelTasks = tasks.filter(t => !t.parent_task_id);
    const subtasks = tasks.filter(t => !!t.parent_task_id);
    const taskMap = {};
    if (topLevelTasks.length > 0) {
      const newTopLevel = await base44.entities.Task.bulkCreate(
        topLevelTasks.map(t => ({
          checklist_id: newChecklist.id,
          company_id: user.company_id,
          group_id: t.group_id ? groupMap[t.group_id] : null,
          title: t.title, description: t.description, task_type: t.task_type,
          sort_order: t.sort_order, is_required: t.is_required,
          estimated_minutes: t.estimated_minutes, scheduled_days: t.scheduled_days, due_time: t.due_time,
        }))
      );
      topLevelTasks.forEach((t, i) => { taskMap[t.id] = newTopLevel[i].id; });
    }
    if (subtasks.length > 0) {
      await base44.entities.Task.bulkCreate(
        subtasks.map(t => ({
          checklist_id: newChecklist.id,
          company_id: user.company_id,
          group_id: t.group_id ? groupMap[t.group_id] : null,
          title: t.title, description: t.description, task_type: t.task_type,
          sort_order: t.sort_order, is_required: t.is_required,
          estimated_minutes: t.estimated_minutes, parent_task_id: taskMap[t.parent_task_id] || null,
          scheduled_days: t.scheduled_days, due_time: t.due_time,
        }))
      );
    }
    queryClient.invalidateQueries({ queryKey: ["checklists"] });
    setDuplicateDialog(false);
    setDuplicatingCl(null);
    toast.success("Checklist duplicated");
  };

  const openMerge = (cl) => {
    setMergeTargetCl(cl);
    setMergeSourceId("");
    setMergeDialog(true);
  };

  const handleMerge = async () => {
    if (!mergeTargetCl || !mergeSourceId) return;
    const [sourceGroups, sourceTasks, targetGroups, targetTasks] = await Promise.all([
      base44.entities.TaskGroup.filter({ checklist_id: mergeSourceId }),
      base44.entities.Task.filter({ checklist_id: mergeSourceId }),
      base44.entities.TaskGroup.filter({ checklist_id: mergeTargetCl.id }),
      base44.entities.Task.filter({ checklist_id: mergeTargetCl.id }),
    ]);

    const maxGroupOrder = targetGroups.length > 0 ? Math.max(...targetGroups.map(g => g.sort_order || 0)) : 0;
    const maxTaskOrder = targetTasks.filter(t => !t.group_id && !t.parent_task_id).length;

    const groupMap = {};
    for (let i = 0; i < sourceGroups.length; i++) {
      const g = sourceGroups[i];
      const newGroup = await base44.entities.TaskGroup.create({
        checklist_id: mergeTargetCl.id,
        company_id: user.company_id,
        name: g.name,
        sort_order: maxGroupOrder + i + 1,
      });
      groupMap[g.id] = newGroup.id;
    }

    const topLevelTasks = sourceTasks.filter(t => !t.parent_task_id);
    const subtasks = sourceTasks.filter(t => !!t.parent_task_id);
    const taskMap = {};

    for (let i = 0; i < topLevelTasks.length; i++) {
      const t = topLevelTasks[i];
      const newTask = await base44.entities.Task.create({
        checklist_id: mergeTargetCl.id,
        company_id: user.company_id,
        group_id: t.group_id ? groupMap[t.group_id] : null,
        title: t.title, description: t.description, task_type: t.task_type,
        sort_order: t.group_id ? t.sort_order : maxTaskOrder + i,
        is_required: t.is_required, estimated_minutes: t.estimated_minutes,
        scheduled_days: t.scheduled_days, due_time: t.due_time,
      });
      taskMap[t.id] = newTask.id;
    }

    for (const t of subtasks) {
      await base44.entities.Task.create({
        checklist_id: mergeTargetCl.id,
        company_id: user.company_id,
        group_id: t.group_id ? groupMap[t.group_id] : null,
        title: t.title, description: t.description, task_type: t.task_type,
        sort_order: t.sort_order, is_required: t.is_required,
        estimated_minutes: t.estimated_minutes, parent_task_id: taskMap[t.parent_task_id] || null,
        scheduled_days: t.scheduled_days, due_time: t.due_time,
      });
    }

    queryClient.invalidateQueries({ queryKey: ["checklists"] });
    setMergeDialog(false);
    setMergeTargetCl(null);
    toast.success(`Merged into "${mergeTargetCl.name}"`);
  };

  const getLocationName = (id) => locations.find((l) => l.id === id)?.name || "Unknown";

  const ChecklistRow = ({ cl }) => (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
      <div>
        <p className="font-medium text-sm">{cl.name}</p>
        <p className="text-xs text-muted-foreground capitalize">{cl.shift_type?.replace("_", " ")}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openMerge(cl)} title="Merge into this"><Merge className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openDuplicate(cl)} title="Duplicate"><Copy className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openRename(cl)} title="Rename"><Pencil className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => openDelete(cl)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
        <Link to={`/dashboard/checklist/${cl.id}/edit`}>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">Edit Tasks <ChevronRight className="h-3.5 w-3.5" /></Button>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Checklist Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">Create and configure checklists for each location</p>
        </div>
        <div className="flex gap-2">
          <Link to="/dashboard/import">
            <Button size="sm" variant="outline"><FileSpreadsheet className="h-4 w-4 mr-1" /> Import</Button>
          </Link>
          <Button size="sm" onClick={() => setClDialog(true)}><Plus className="h-4 w-4 mr-1" /> Add Checklist</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Checklists by Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {locations.map((loc) => {
            const locChecklists = checklists.filter(cl => cl.location_id === loc.id);
            if (locChecklists.length === 0) return null;
            return (
              <div key={loc.id}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> {loc.name}
                </p>
                <div className="space-y-2">
                  {locChecklists.map((cl) => <ChecklistRow key={cl.id} cl={cl} />)}
                </div>
              </div>
            );
          })}
          {checklists.filter(cl => !locations.find(l => l.id === cl.location_id)).map((cl) => (
            <ChecklistRow key={cl.id} cl={cl} />
          ))}
          {checklists.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No checklists yet. Click "Add Checklist" to get started.</p>
          )}
        </CardContent>
      </Card>

      {/* Checklist Dialog */}
      <Dialog open={clDialog} onOpenChange={setClDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Checklist</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={clName} onChange={(e) => setClName(e.target.value)} placeholder="e.g. Opening Checklist" /></div>
            <div>
              <Label>Location</Label>
              <Select value={clLocationId} onValueChange={setClLocationId}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.filter((l) => l.is_active).map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Shift Type</Label>
              <Select value={clShift} onValueChange={setClShift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="opening">Opening</SelectItem>
                  <SelectItem value="mid_shift">Mid-Shift</SelectItem>
                  <SelectItem value="closing">Closing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={addChecklist} disabled={!clName.trim() || !clLocationId}>Add Checklist</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialog} onOpenChange={setRenameDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename Checklist</DialogTitle></DialogHeader>
          <div><Label>Name</Label><Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRename()} autoFocus /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(false)}>Cancel</Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Checklist</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{deletingCl?.name}</strong>? All tasks will also be deleted.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={mergeDialog} onOpenChange={setMergeDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Merge into "{mergeTargetCl?.name}"</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">All groups and tasks from the selected checklist will be copied into <strong>{mergeTargetCl?.name}</strong>. The source checklist will not be deleted.</p>
            <div>
              <Label>Source Checklist</Label>
              <Select value={mergeSourceId} onValueChange={setMergeSourceId}>
                <SelectTrigger><SelectValue placeholder="Select checklist to merge from" /></SelectTrigger>
                <SelectContent>
                  {checklists.filter(cl => cl.id !== mergeTargetCl?.id).map(cl => (
                    <SelectItem key={cl.id} value={cl.id}>
                      {cl.name} {locations.find(l => l.id === cl.location_id) ? `(${locations.find(l => l.id === cl.location_id).name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialog(false)}>Cancel</Button>
            <Button onClick={handleMerge} disabled={!mergeSourceId}>Merge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialog} onOpenChange={setDuplicateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Duplicate Checklist</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Copy <strong>{duplicatingCl?.name}</strong> to a location.</p>
            <div>
              <Label>Target Location</Label>
              <Select value={dupLocationId} onValueChange={setDupLocationId}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.filter((l) => l.is_active).map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateDialog(false)}>Cancel</Button>
            <Button onClick={handleDuplicate} disabled={!dupLocationId}>Duplicate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}