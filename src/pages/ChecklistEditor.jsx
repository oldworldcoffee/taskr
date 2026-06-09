import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight, GripVertical, Pencil, ListTree, FolderPlus, Folder, BookOpen, X } from "lucide-react";
import KBMentionTextarea from "@/components/kb/KBMentionTextarea";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

const TASK_TYPES = [
  { value: "checkbox", label: "Checkbox" },
  { value: "text_input", label: "Text Input" },
  { value: "photo_upload", label: "Photo Upload" },
  { value: "yes_no", label: "Yes / No" },
  { value: "cash_deposit", label: "Cash Deposit" },
];

const taskTypeColors = {
  checkbox: "bg-primary/10 text-primary border-primary/20",
  text_input: "bg-blue-50 text-blue-700 border-blue-200",
  photo_upload: "bg-amber-50 text-amber-700 border-amber-200",
  yes_no: "bg-green-50 text-green-700 border-green-200",
  cash_deposit: "bg-purple-50 text-purple-700 border-purple-200",
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

function TaskDialog({ open, onOpenChange, onSave, initial, parentLabel, groups, tasks, allowGroupAssignment, allowParentAssignment }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [taskType, setTaskType] = useState(initial?.task_type || "checkbox");
  const [isRequired, setIsRequired] = useState(initial?.is_required ?? false);
  const [estimatedMinutes, setEstimatedMinutes] = useState(initial?.estimated_minutes?.toString() || "1");
  const [dueTime, setDueTime] = useState(initial?.due_time || "");
  const [scheduleMode, setScheduleMode] = useState(
    !initial?.scheduled_days || initial.scheduled_days.includes("daily") ? "daily" : "specific"
  );
  const [selectedDays, setSelectedDays] = useState(
    initial?.scheduled_days?.filter(d => d !== "daily") || []
  );
  const [selectedGroupId, setSelectedGroupId] = useState(initial?.group_id || "");
  const [selectedParentId, setSelectedParentId] = useState(initial?.parent_task_id || "");

  // Re-sync state when dialog opens with new initial values (e.g. clicking a group's Add Task button)
  useEffect(() => {
    if (open) {
      setTitle(initial?.title || "");
      setDescription(initial?.description || "");
      setTaskType(initial?.task_type || "checkbox");
      setIsRequired(initial?.is_required ?? false);
      setEstimatedMinutes(initial?.estimated_minutes?.toString() || "1");
      setDueTime(initial?.due_time || "");
      setScheduleMode(!initial?.scheduled_days || initial.scheduled_days.includes("daily") ? "daily" : "specific");
      setSelectedDays(initial?.scheduled_days?.filter(d => d !== "daily") || []);
      setSelectedGroupId(initial?.group_id || "");
      setSelectedParentId(initial?.parent_task_id || "");
    }
  }, [open]);
  const [linkedKbIds, setLinkedKbIds] = useState(initial?.kb_article_ids || []);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);

  const { data: kbArticles = [] } = useQuery({
    queryKey: ["kb-articles"],
    queryFn: () => base44.entities.KBArticle.list(),
    enabled: open,
  });

  const toggleDay = (day) => {
    setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const handleSave = () => {
    if (!title.trim()) return;
    const scheduled_days = scheduleMode === "daily" ? ["daily"] : selectedDays;
    onSave({
      title: title.trim(),
      description: description.trim(),
      task_type: taskType,
      is_required: isRequired,
      estimated_minutes: Number(estimatedMinutes) || 1,
      due_time: dueTime || null,
      scheduled_days,
      group_id: selectedGroupId || null,
      parent_task_id: selectedParentId || null,
      kb_article_ids: linkedKbIds,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Task" : parentLabel ? `Add Subtask to "${parentLabel}"` : "Add Task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Task Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Check espresso machine" autoFocus />
          </div>
          <div>
            <Label>Instructions / Description</Label>
            <KBMentionTextarea value={description} onChange={setDescription} placeholder="Optional details or instructions..." rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Input Type</Label>
              <Select value={taskType} onValueChange={setTaskType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Est. Minutes</Label>
              <Input type="number" min="1" value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="mb-1 block">Schedule</Label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setScheduleMode("daily")}
                className={`flex-1 py-1.5 rounded-md border text-sm transition-colors ${scheduleMode === "daily" ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted/40"}`}
              >
                Every day
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode("specific")}
                className={`flex-1 py-1.5 rounded-md border text-sm transition-colors ${scheduleMode === "specific" ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted/40"}`}
              >
                Specific days
              </button>
            </div>
            {scheduleMode === "specific" && (
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map(day => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${selectedDays.includes(day) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                  >
                    {DAY_LABELS[day]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Due By (optional)</Label>
            <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="w-36" />
            <p className="text-xs text-muted-foreground mt-1">Tasks not completed by this time will be flagged.</p>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isRequired} onCheckedChange={setIsRequired} />
            <Label>Required task</Label>
          </div>

          {allowGroupAssignment && groups && groups.length > 0 && (
            <div>
              <Label>Assign to Group</Label>
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger><SelectValue placeholder="No group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No group</SelectItem>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {allowParentAssignment && tasks && tasks.length > 0 && (
            <div>
              <Label>Parent Task (optional)</Label>
              <Select value={selectedParentId} onValueChange={setSelectedParentId}>
                <SelectTrigger><SelectValue placeholder="No parent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No parent</SelectItem>
                  {tasks.filter(t => !t.parent_task_id).map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Leave empty for a top-level task.</p>
            </div>
          )}
          {/* KB Article linking */}
          <div>
            <Label>Linked Knowledge Base Articles</Label>
            <div className="flex flex-wrap gap-1.5 mt-1 mb-1">
              {linkedKbIds.map(id => {
                const a = kbArticles.find(x => x.id === id);
                return a ? (
                  <span key={id} className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs">
                    <BookOpen className="h-3 w-3" />{a.title}
                    <button type="button" onClick={() => setLinkedKbIds(prev => prev.filter(i => i !== id))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ) : null;
              })}
              <button type="button" onClick={() => setKbPickerOpen(!kbPickerOpen)} className="flex items-center gap-1 px-2 py-0.5 border rounded-full text-xs text-muted-foreground hover:text-primary hover:border-primary">
                <BookOpen className="h-3 w-3" /> Link Article
              </button>
            </div>
            {kbPickerOpen && kbArticles.length > 0 && (
              <div className="border rounded-lg p-2 bg-muted/20 max-h-36 overflow-y-auto space-y-0.5">
                {kbArticles.map(a => (
                  <label key={a.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={linkedKbIds.includes(a.id)}
                      onChange={e => setLinkedKbIds(prev => e.target.checked ? [...prev, a.id] : prev.filter(i => i !== a.id))}
                    />
                    {a.title}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim()}>{initial ? "Save Changes" : "Add Task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupDialog({ open, onOpenChange, onSave, initial }) {
  const [name, setName] = useState(initial?.name || "");

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? "Rename Group" : "Add Task Group"}</DialogTitle>
        </DialogHeader>
        <div>
          <Label>Group Name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Closing Front of House"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>{initial ? "Save" : "Add Group"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({ task, subtasks, onEdit, onDelete, onAddSubtask, index }) {
  const [expanded, setExpanded] = useState(true);
  const hasSubtasks = subtasks.length > 0;

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={snapshot.isDragging ? "opacity-50" : ""}
        >
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 group">
            <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
              <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center"
            >
              {hasSubtasks ? (
                expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              ) : <span className="w-3.5" />}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{task.title}</span>
                {task.is_required && <span className="text-xs text-destructive font-semibold">Required</span>}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {task.description && <p className="text-xs text-muted-foreground truncate">{task.description}</p>}
                {task.scheduled_days?.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {task.scheduled_days.includes("daily") ? "Daily" : task.scheduled_days.map(d => d.slice(0,3).charAt(0).toUpperCase() + d.slice(1,3)).join(", ")}
                  </span>
                )}
                {task.due_time && <span className="text-xs text-amber-600 font-medium">Due {task.due_time}</span>}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant="outline" className={`text-xs ${taskTypeColors[task.task_type]}`}>
                {TASK_TYPES.find(t => t.value === task.task_type)?.label}
              </Badge>
              <span className="text-xs text-muted-foreground">{task.estimated_minutes}m</span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onAddSubtask(task)} title="Add subtask">
                  <ListTree className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(task)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(task)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {hasSubtasks && expanded && (
            <Droppable droppableId={`subtasks-${task.id}`} type="subtask">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="ml-8 mt-1 space-y-1 border-l-2 border-border/50 pl-3"
                >
                  {subtasks.map((sub, subIndex) => (
                    <SubtaskRow
                      key={sub.id}
                      task={sub}
                      index={subIndex}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          )}
        </div>
      )}
    </Draggable>
  );
}

function SubtaskRow({ task, index, onEdit, onDelete }) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`flex items-center gap-2 p-2.5 rounded-lg bg-muted/20 hover:bg-muted/40 group ${snapshot.isDragging ? "opacity-50" : ""}`}
        >
          <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm">{task.title}</span>
              {task.is_required && <span className="text-xs text-destructive font-semibold">Required</span>}
            </div>
            {task.description && <p className="text-xs text-muted-foreground truncate">{task.description}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="outline" className={`text-xs ${taskTypeColors[task.task_type]}`}>
              {TASK_TYPES.find(t => t.value === task.task_type)?.label}
            </Badge>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(task)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(task)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}

function GroupSection({ group, allTasks, onEditGroup, onDeleteGroup, onAddTask, onEditTask, onDeleteTask, onAddSubtask, dragHandleProps }) {
  const [expanded, setExpanded] = useState(true);
  const getSubtasks = (parentId) => allTasks.filter(t => t.parent_task_id === parentId).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const topLevel = allTasks.filter(t => !t.parent_task_id && t.group_id === group.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-sidebar/10 border-b border-border group">
        <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing flex-shrink-0">
          <GripVertical className="h-4 w-4 text-muted-foreground/40" />
        </div>
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 flex-1 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
          <Folder className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="font-semibold text-sm">{group.name}</span>
          <span className="text-xs text-muted-foreground ml-1">({topLevel.length} tasks)</span>
        </button>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onAddTask(group)}>
            <Plus className="h-3.5 w-3.5" /> Add Task
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEditGroup(group)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDeleteGroup(group)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tasks inside group */}
      {expanded && (
        <Droppable droppableId={`tasks-${group.id}`} type="tasks">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`p-3 space-y-2 min-h-[48px] transition-colors ${snapshot.isDraggingOver ? "bg-primary/5" : ""}`}
            >
              {topLevel.length === 0 && !snapshot.isDraggingOver ? (
                <p className="text-xs text-muted-foreground text-center py-4">No tasks yet. Add a task to this group.</p>
              ) : (
                topLevel.map((task, index) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={index}
                    subtasks={getSubtasks(task.id)}
                    onEdit={onEditTask}
                    onDelete={onDeleteTask}
                    onAddSubtask={onAddSubtask}
                  />
                ))
              )}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      )}
    </div>
  );
}

export default function ChecklistEditor() {
  const { checklistId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [addGroupDialog, setAddGroupDialog] = useState(false);
  const [editGroupDialog, setEditGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);

  const [addTaskDialog, setAddTaskDialog] = useState(false);
  const [addTaskGroup, setAddTaskGroup] = useState(null); // group to add task into (null = ungrouped)
  const [editDialog, setEditDialog] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [subtaskParent, setSubtaskParent] = useState(null);

  const { data: checklist } = useQuery({
    queryKey: ["checklist", checklistId],
    queryFn: () => base44.entities.Checklist.filter({ id: checklistId }).then(r => r[0]),
    enabled: !!checklistId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: user.company_id }),
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["task-groups", checklistId],
    queryFn: () => base44.entities.TaskGroup.filter({ checklist_id: checklistId, company_id: user.company_id }),
    enabled: !!checklistId,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", checklistId],
    queryFn: () => base44.entities.Task.filter({ checklist_id: checklistId, company_id: user.company_id }),
    enabled: !!checklistId,
  });

  const locationName = locations.find(l => l.id === checklist?.location_id)?.name || "";
  const sortedGroups = [...groups].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  // Tasks that belong to a group (top-level)
  const getGroupTasks = (groupId) => tasks.filter(t => t.group_id === groupId && !t.parent_task_id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  // Ungrouped top-level tasks
  const ungroupedTasks = tasks.filter(t => !t.group_id && !t.parent_task_id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const getSubtasks = (parentId) => tasks.filter(t => t.parent_task_id === parentId).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);

  // --- Group CRUD ---
  const handleAddGroup = async (data) => {
    const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.sort_order || 0)) : 0;
    await base44.entities.TaskGroup.create({ ...data, company_id: user.company_id, checklist_id: checklistId, sort_order: maxOrder + 1 });
    queryClient.invalidateQueries({ queryKey: ["task-groups", checklistId] });
    toast.success("Group added");
  };

  const handleEditGroup = async (data) => {
    await base44.entities.TaskGroup.update(editingGroup.id, data);
    queryClient.invalidateQueries({ queryKey: ["task-groups", checklistId] });
    toast.success("Group renamed");
    setEditingGroup(null);
  };

  const handleDeleteGroup = async (group) => {
    // Move tasks in this group to ungrouped
    const groupTasks = getGroupTasks(group.id);
    await Promise.all(groupTasks.map(t => base44.entities.Task.update(t.id, { group_id: null })));
    await base44.entities.TaskGroup.delete(group.id);
    queryClient.invalidateQueries({ queryKey: ["task-groups", checklistId] });
    queryClient.invalidateQueries({ queryKey: ["tasks", checklistId] });
    toast.success("Group deleted — tasks moved to ungrouped");
  };

  // --- Task CRUD ---
  const handleAddTask = async (data) => {
    // Prefer the group selected in the dialog; fall back to the group context button was clicked from
    const groupId = data.group_id || addTaskGroup?.id || null;
    const groupTasks = groupId ? getGroupTasks(groupId) : ungroupedTasks;
    const maxOrder = groupTasks.length > 0 ? Math.max(...groupTasks.map(t => t.sort_order || 0)) : 0;
    await base44.entities.Task.create({
      ...data,
      company_id: user.company_id,
      checklist_id: checklistId,
      group_id: groupId,
      parent_task_id: null,
      sort_order: maxOrder + 1,
    });
    queryClient.invalidateQueries({ queryKey: ["tasks", checklistId] });
    toast.success("Task added");
    setAddTaskGroup(null);
  };

  const handleAddSubtask = async (data) => {
    const existingSubs = getSubtasks(subtaskParent.id);
    const maxOrder = existingSubs.length > 0 ? Math.max(...existingSubs.map(t => t.sort_order || 0)) : 0;
    await base44.entities.Task.create({
      ...data,
      company_id: user.company_id,
      checklist_id: checklistId,
      group_id: subtaskParent.group_id || null,
      parent_task_id: subtaskParent.id,
      sort_order: maxOrder + 1,
    });
    queryClient.invalidateQueries({ queryKey: ["tasks", checklistId] });
    toast.success("Subtask added");
    setSubtaskParent(null);
  };

  const handleEditTask = async (data) => {
    await base44.entities.Task.update(editingTask.id, data);
    queryClient.invalidateQueries({ queryKey: ["tasks", checklistId] });
    toast.success("Task updated");
    setEditingTask(null);
  };

  const handleDeleteTask = async (task) => {
    const subs = getSubtasks(task.id);
    await Promise.all(subs.map(s => base44.entities.Task.delete(s.id)));
    await base44.entities.Task.delete(task.id);
    queryClient.invalidateQueries({ queryKey: ["tasks", checklistId] });
    toast.success("Task deleted");
  };

  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    const { source, destination, type } = result;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Group reordering
    if (type === "groups") {
      const reordered = [...sortedGroups];
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      await Promise.all(reordered.map((g, i) => base44.entities.TaskGroup.update(g.id, { sort_order: i })));
      queryClient.invalidateQueries({ queryKey: ["task-groups", checklistId] });
      return;
    }

    // Subtask reordering (within same parent only)
    if (type === "subtask") {
      const parentId = source.droppableId.replace("subtasks-", "");
      const subtasks = getSubtasks(parentId);
      const newIds = Array.from(subtasks.map(t => t.id));
      const [removed] = newIds.splice(source.index, 1);
      newIds.splice(destination.index, 0, removed);
      await Promise.all(newIds.map((id, i) => base44.entities.Task.update(id, { sort_order: i })));
      queryClient.invalidateQueries({ queryKey: ["tasks", checklistId] });
      return;
    }

    // Top-level task reordering / cross-group move
    if (type === "tasks") {
      const srcGroupId = source.droppableId === "ungrouped-tasks" ? null : source.droppableId.replace("tasks-", "");
      const destGroupId = destination.droppableId === "ungrouped-tasks" ? null : destination.droppableId.replace("tasks-", "");

      const srcTasks = [...(srcGroupId ? getGroupTasks(srcGroupId) : ungroupedTasks)];
      const [movedTask] = srcTasks.splice(source.index, 1);

      if (srcGroupId === destGroupId) {
        // Same group reorder
        srcTasks.splice(destination.index, 0, movedTask);
        await Promise.all(srcTasks.map((t, i) => base44.entities.Task.update(t.id, { sort_order: i })));
      } else {
        // Cross-group move
        const destTasks = [...(destGroupId ? getGroupTasks(destGroupId) : ungroupedTasks)];
        destTasks.splice(destination.index, 0, movedTask);
        await Promise.all([
          ...srcTasks.map((t, i) => base44.entities.Task.update(t.id, { sort_order: i })),
          ...destTasks.map((t, i) => base44.entities.Task.update(t.id, { group_id: destGroupId, sort_order: i })),
        ]);
      }
      queryClient.invalidateQueries({ queryKey: ["tasks", checklistId] });
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/dashboard/checklists/setup">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{checklist?.name || "Checklist"}</h1>
          {locationName && (
            <p className="text-sm text-muted-foreground">
              {locationName} · {checklist?.shift_type?.replace("_", " ")} · ~{totalMinutes} min total
            </p>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setAddGroupDialog(true)}>
          <FolderPlus className="h-4 w-4 mr-1" /> Add Group
        </Button>
        <Button size="sm" onClick={() => { setAddTaskGroup(null); setAddTaskDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Task
        </Button>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        {/* Groups */}
        <Droppable droppableId="groups" type="groups">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
              {sortedGroups.map((group, index) => (
                <Draggable key={group.id} draggableId={`group-${group.id}`} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={snapshot.isDragging ? "opacity-60" : ""}
                    >
                      <GroupSection
                        group={group}
                        allTasks={tasks}
                        onEditGroup={(g) => { setEditingGroup(g); setEditGroupDialog(true); }}
                        onDeleteGroup={handleDeleteGroup}
                        onAddTask={(g) => { setAddTaskGroup(g); setAddTaskDialog(true); }}
                        onEditTask={(t) => { setEditingTask(t); setEditDialog(true); }}
                        onDeleteTask={handleDeleteTask}
                        onAddSubtask={(t) => setSubtaskParent(t)}
                        dragHandleProps={provided.dragHandleProps}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>

        {/* Ungrouped tasks */}
        {(ungroupedTasks.length > 0 || sortedGroups.length === 0) && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base text-muted-foreground font-normal">
                {sortedGroups.length > 0 ? "Ungrouped Tasks" : "Tasks"}
                <span className="ml-1 text-sm">({ungroupedTasks.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Droppable droppableId="ungrouped-tasks" type="tasks">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`min-h-[48px] space-y-2 transition-colors ${snapshot.isDraggingOver ? "bg-primary/5 rounded-lg p-1" : ""}`}
                  >
                    {ungroupedTasks.length === 0 && !snapshot.isDraggingOver ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <ListTree className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No tasks yet. Add a group or a task above.</p>
                      </div>
                    ) : (
                      ungroupedTasks.map((task, index) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          index={index}
                          subtasks={getSubtasks(task.id)}
                          onEdit={(t) => { setEditingTask(t); setEditDialog(true); }}
                          onDelete={handleDeleteTask}
                          onAddSubtask={(t) => setSubtaskParent(t)}
                        />
                      ))
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </CardContent>
          </Card>
        )}
      </DragDropContext>

      {/* Dialogs */}
      <GroupDialog open={addGroupDialog} onOpenChange={setAddGroupDialog} onSave={handleAddGroup} />
      {editingGroup && (
        <GroupDialog
          open={editGroupDialog}
          onOpenChange={(o) => { setEditGroupDialog(o); if (!o) setEditingGroup(null); }}
          onSave={handleEditGroup}
          initial={editingGroup}
        />
      )}

      <TaskDialog
        open={addTaskDialog}
        onOpenChange={(o) => { setAddTaskDialog(o); if (!o) setAddTaskGroup(null); }}
        onSave={handleAddTask}
        initial={addTaskGroup ? { group_id: addTaskGroup.id } : undefined}
        groups={sortedGroups}
        tasks={ungroupedTasks}
        allowGroupAssignment={true}
        allowParentAssignment={true}
      />
      <TaskDialog
        open={!!subtaskParent}
        onOpenChange={(open) => { if (!open) setSubtaskParent(null); }}
        onSave={handleAddSubtask}
        parentLabel={subtaskParent?.title}
        initial={{ parent_task_id: subtaskParent?.id }}
        groups={sortedGroups}
        tasks={tasks.filter(t => t.group_id === (subtaskParent?.group_id || null) && !t.parent_task_id)}
        allowGroupAssignment={false}
        allowParentAssignment={true}
      />
      {editingTask && (
        <TaskDialog
          open={editDialog}
          onOpenChange={(open) => { setEditDialog(open); if (!open) setEditingTask(null); }}
          onSave={handleEditTask}
          initial={editingTask}
          groups={sortedGroups}
          tasks={tasks}
          allowGroupAssignment={true}
          allowParentAssignment={true}
        />
      )}
    </div>
  );
}