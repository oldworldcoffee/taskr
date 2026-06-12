import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { format, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Trash2,
  Pencil,
  ListChecks,
  Users,
  Repeat,
  Calendar as CalendarIcon,
  Bell,
  Archive,
  ArchiveRestore,
  GripVertical,
} from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { toast } from "sonner";
import MemberPicker from "@/components/shared/MemberPicker";
import MyTodos from "@/components/todos/MyTodos";
import {
  WEEKDAYS,
  computeDueDates,
  resolveAssignees,
  ensureOccurrences,
} from "@/lib/todos";

const ROLES = ["employee", "supervisor", "manager", "admin"];

function recurrenceLabel(todo) {
  if (todo.recurrence === "one_off") {
    return todo.due_date ? `One-off · ${todo.due_date}` : "One-off";
  }
  if (todo.recurrence === "weekly") {
    const days = (todo.recurrence_days || []).map((d) => d.slice(0, 3)).join(", ");
    return `Weekly · ${days || "no days"}`;
  }
  if (todo.recurrence === "monthly") {
    return `Monthly · day ${todo.recurrence_day_of_month || "?"}`;
  }
  return todo.recurrence;
}

const emptyTodo = {
  name: "",
  description: "",
  category: "",
  recurrence: "one_off",
  recurrence_days: [],
  recurrence_day_of_month: 1,
  due_date: format(new Date(), "yyyy-MM-dd"),
  due_time: "",
  assignee_emails: [],
  assignee_roles: [],
  group_ids: [],
  notify_emails: [],
  is_active: true,
};

export default function DashboardTodos() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: allUsers = [] } = useQuery({
    queryKey: ["company-users"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyUsers", {});
      return res.data?.users || [];
    },
  });

  const { data: todos = [], refetch: refetchTodos } = useQuery({
    queryKey: ["todos"],
    queryFn: () => base44.entities.Todo.filter({ company_id: user.company_id }, "sort_order"),
    enabled: !!user?.company_id,
  });

  const { data: groups = [], refetch: refetchGroups } = useQuery({
    queryKey: ["todo-groups"],
    queryFn: () => base44.entities.TodoGroup.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  const { data: occurrences = [], refetch: refetchOccurrences } = useQuery({
    queryKey: ["todo-occurrences-all"],
    queryFn: () =>
      base44.entities.TodoOccurrence.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  useEffect(() => {
    const unsub = base44.entities.TodoOccurrence.subscribe(() => refetchOccurrences());
    return () => unsub();
  }, []);

  const today = format(new Date(), "yyyy-MM-dd");

  const activeTodos = useMemo(() => todos.filter((t) => !t.archived_at), [todos]);
  const archivedTodos = useMemo(
    () =>
      todos
        .filter((t) => t.archived_at)
        .sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1)),
    [todos]
  );

  // Unique category values for the editor's datalist (case-insensitive dedupe,
  // keep first-seen casing) and for grouping the active list.
  const existingCategories = useMemo(() => {
    const seen = new Map();
    for (const t of todos) {
      const c = (t.category || "").trim();
      if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [todos]);

  // Group order follows the todos' sort_order (the query sorts by it): a
  // group appears where its first todo does, so drag-reordering groups is
  // just a renumbering of the flat sequence. Uncategorized ("Other") is
  // always last.
  const categoryGroups = useMemo(() => {
    const map = new Map();
    for (const t of activeTodos) {
      const cat = (t.category || "").trim() || null;
      const key = cat ? cat.toLowerCase() : "__other";
      if (!map.has(key)) map.set(key, { key, category: cat, todos: [] });
      map.get(key).todos.push(t);
    }
    const groups = [...map.values()];
    return [...groups.filter((g) => g.category), ...groups.filter((g) => !g.category)];
  }, [activeTodos]);
  const hasCategories = categoryGroups.some((g) => g.category);

  // Drag & drop: rebuild the displayed group/item arrays, flatten them back
  // into one sequence, renumber sort_order, and persist whatever changed.
  const handleDragEnd = async (result) => {
    const { source, destination, type } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index)
      return;

    let groupsArr = categoryGroups.map((g) => ({ ...g, todos: [...g.todos] }));

    if (type === "groups") {
      const [moved] = groupsArr.splice(source.index, 1);
      groupsArr.splice(destination.index, 0, moved);
      // "Other" stays last no matter where it was dropped relative to it.
      groupsArr = [...groupsArr.filter((g) => g.category), ...groupsArr.filter((g) => !g.category)];
    } else {
      const src = groupsArr.find((g) => `cat-${g.key}` === source.droppableId);
      const dst = groupsArr.find((g) => `cat-${g.key}` === destination.droppableId);
      if (!src || !dst) return;
      const [moved] = src.todos.splice(source.index, 1);
      dst.todos.splice(destination.index, 0, moved);
    }

    const flat = groupsArr.flatMap((g) =>
      g.todos.map((t) => ({ id: t.id, category: g.category }))
    );
    const updates = [];
    flat.forEach((f, i) => {
      const orig = todos.find((t) => t.id === f.id);
      const patch = {};
      if ((orig?.sort_order ?? null) !== i) patch.sort_order = i;
      if (((orig?.category || "").trim() || null) !== f.category) patch.category = f.category;
      if (Object.keys(patch).length) updates.push({ id: f.id, patch });
    });
    if (updates.length === 0) return;

    // Optimistic: reorder the cache immediately so the drop doesn't snap back.
    queryClient.setQueryData(["todos"], (old = []) => {
      const pos = new Map(flat.map((f, i) => [f.id, i]));
      return old
        .map((t) =>
          pos.has(t.id) ? { ...t, sort_order: pos.get(t.id), category: flat[pos.get(t.id)].category } : t
        )
        .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
    });
    try {
      await Promise.all(updates.map((u) => base44.entities.Todo.update(u.id, u.patch)));
    } catch (e) {
      toast.error(e.message || "Could not save the new order");
    }
    refetchTodos();
    queryClient.invalidateQueries({ queryKey: ["todos"] });
  };

  const statsByTodo = useMemo(() => {
    const map = {};
    for (const o of occurrences) {
      const s = (map[o.todo_id] = map[o.todo_id] || { pending: 0, completed: 0, overdue: 0 });
      if (o.status === "completed") s.completed += 1;
      else if (o.due_date && o.due_date < today) s.overdue += 1;
      else s.pending += 1;
    }
    return map;
  }, [occurrences, today]);

  // ---- To-Do editor dialog ----
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(emptyTodo);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const openNew = () => {
    setDraft(emptyTodo);
    setEditingId(null);
    setEditorOpen(true);
  };

  const openEdit = (todo) => {
    setDraft({ ...emptyTodo, ...todo });
    setEditingId(todo.id);
    setEditorOpen(true);
  };

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const toggleArr = (key, value) =>
    setDraft((d) => {
      const arr = d[key] || [];
      return {
        ...d,
        [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
      };
    });

  const hasAssignees =
    (draft.assignee_emails?.length || 0) +
      (draft.assignee_roles?.length || 0) +
      (draft.group_ids?.length || 0) >
    0;

  const saveTodo = async () => {
    if (!draft.name.trim()) {
      toast.error("Give the to-do a name.");
      return;
    }
    if (!hasAssignees) {
      toast.error("Assign the to-do to at least one person, role, or group.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: user.company_id,
        name: draft.name.trim(),
        description: draft.description || null,
        category: draft.category?.trim() || null,
        created_by_email: user.email,
        created_by_name: user.full_name || user.email,
        assignee_emails: draft.assignee_emails || [],
        assignee_roles: draft.assignee_roles || [],
        group_ids: draft.group_ids || [],
        recurrence: draft.recurrence,
        recurrence_days: draft.recurrence === "weekly" ? draft.recurrence_days || [] : [],
        recurrence_day_of_month:
          draft.recurrence === "monthly" ? Number(draft.recurrence_day_of_month) || 1 : null,
        due_time: draft.due_time || null,
        due_date: draft.recurrence === "one_off" ? draft.due_date || null : null,
        notify_emails: draft.notify_emails || [],
        is_active: draft.is_active !== false,
      };
      if (!editingId) {
        payload.sort_order =
          todos.reduce((m, t) => Math.max(m, t.sort_order ?? -1), -1) + 1;
      }

      const saved = editingId
        ? await base44.entities.Todo.update(editingId, payload)
        : await base44.entities.Todo.create(payload);

      // Materialize occurrences for a forward window so they show up right away.
      const assignees = resolveAssignees(saved, allUsers, groups);
      await ensureOccurrences({
        todo: saved,
        assignees,
        windowStart: new Date(),
        windowEnd: addDays(new Date(), 30),
        companyId: user.company_id,
        existingOccurrences: occurrences,
      });

      toast.success(editingId ? "To-Do updated" : "To-Do created");
      setEditorOpen(false);
      refetchTodos();
      refetchOccurrences();
      // Prefix match also refreshes ["todos", company_id] used by the
      // embedded My Tasks strip and the employee views.
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      queryClient.invalidateQueries({ queryKey: ["my-todo-occurrences"] });
    } catch (e) {
      toast.error(e.message || "Could not save to-do");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      // Remove its occurrences first, then the template.
      const its = occurrences.filter((o) => o.todo_id === deleteTarget.id);
      await Promise.all(its.map((o) => base44.entities.TodoOccurrence.delete(o.id)));
      await base44.entities.Todo.delete(deleteTarget.id);
      toast.success("To-Do deleted");
      setDeleteTarget(null);
      refetchTodos();
      refetchOccurrences();
    } catch (e) {
      toast.error(e.message || "Could not delete");
    }
  };

  const nextDue = (todo) => {
    const dates = computeDueDates(todo, new Date(), addDays(new Date(), 60));
    return dates[0] || null;
  };

  // Archive is reversible (Restore lives in the Archived tab), so no confirm.
  const archiveTodo = async (todo) => {
    try {
      await base44.entities.Todo.update(todo.id, {
        archived_at: new Date().toISOString(),
      });
      toast.success("To-Do archived");
      refetchTodos();
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    } catch (e) {
      toast.error(e.message || "Could not archive");
    }
  };

  const restoreTodo = async (todo) => {
    try {
      await base44.entities.Todo.update(todo.id, { archived_at: null });
      toast.success("To-Do restored");
      refetchTodos();
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    } catch (e) {
      toast.error(e.message || "Could not restore");
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-primary" /> To-Dos
          </h1>
          <p className="text-muted-foreground text-sm">
            Assign recurring or one-off tasks to people, roles, or groups.
          </p>
        </div>
      </div>

      {/* The signed-in admin's own tasks, so they can check things off here
          without switching to the employee view. */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <ListChecks className="h-4 w-4 text-primary" /> My Tasks
          </h2>
          <MyTodos compact />
        </CardContent>
      </Card>

      <Tabs defaultValue="todos">
        <TabsList>
          <TabsTrigger value="todos">To-Dos</TabsTrigger>
          <TabsTrigger value="archived">
            Archived{archivedTodos.length > 0 ? ` (${archivedTodos.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>

        {/* ---- To-Dos tab ---- */}
        <TabsContent value="todos" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" /> New To-Do
            </Button>
          </div>

          {activeTodos.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <ListChecks className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No to-dos yet. Create one to get started.</p>
            </div>
          )}

          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="category-groups" type="groups">
              {(groupsProvided) => (
                <div
                  ref={groupsProvided.innerRef}
                  {...groupsProvided.droppableProps}
                  className="space-y-4"
                >
                  {categoryGroups.map((g, gi) => (
                    <Draggable
                      key={g.key}
                      draggableId={`group-${g.key}`}
                      index={gi}
                      isDragDisabled={!g.category}
                    >
                      {(groupProvided) => (
                        <div ref={groupProvided.innerRef} {...groupProvided.draggableProps}>
                          <div
                            {...groupProvided.dragHandleProps}
                            className={hasCategories ? "mb-2" : "hidden"}
                          >
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 cursor-grab">
                              {g.category && <GripVertical className="h-3.5 w-3.5 opacity-50" />}
                              {g.category || "Other"}
                            </h3>
                          </div>
                          <Droppable droppableId={`cat-${g.key}`} type="todos">
                            {(itemsProvided, itemsSnapshot) => (
                              <div
                                ref={itemsProvided.innerRef}
                                {...itemsProvided.droppableProps}
                                className={`grid gap-3 rounded-lg transition-colors ${
                                  itemsSnapshot.isDraggingOver ? "bg-muted/40 p-2 -m-2" : ""
                                }`}
                              >
                                {g.todos.map((todo, ti) => (
                                  <Draggable key={todo.id} draggableId={todo.id} index={ti}>
                                    {(itemProvided) => (
                                      <div
                                        ref={itemProvided.innerRef}
                                        {...itemProvided.draggableProps}
                                        {...itemProvided.dragHandleProps}
                                      >
                                        <TodoCard
                                          todo={todo}
                                          stats={statsByTodo[todo.id]}
                                          due={nextDue(todo)}
                                          onEdit={() => openEdit(todo)}
                                          onArchive={() => archiveTodo(todo)}
                                          onDelete={() => setDeleteTarget(todo)}
                                        />
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {itemsProvided.placeholder}
                              </div>
                            )}
                          </Droppable>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {groupsProvided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </TabsContent>

        {/* ---- Archived tab ---- */}
        <TabsContent value="archived" className="space-y-4 pt-4">
          {archivedTodos.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Archive className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Nothing archived. Completed one-offs land here automatically.</p>
            </div>
          )}

          <div className="grid gap-3">
            {archivedTodos.map((todo) => (
              <TodoCard
                key={todo.id}
                todo={todo}
                stats={statsByTodo[todo.id]}
                archived
                onRestore={() => restoreTodo(todo)}
                onDelete={() => setDeleteTarget(todo)}
              />
            ))}
          </div>
        </TabsContent>

        {/* ---- Groups tab ---- */}
        <TabsContent value="groups" className="pt-4">
          <GroupsManager
            user={user}
            allUsers={allUsers}
            groups={groups}
            refetchGroups={refetchGroups}
          />
        </TabsContent>
      </Tabs>

      {/* ---- Editor dialog ---- */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit To-Do" : "New To-Do"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Submit weekly sales report"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={draft.description || ""}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Optional details / instructions"
              />
            </div>
            <div>
              <Label>Category (optional)</Label>
              <Input
                list="todo-category-options"
                value={draft.category || ""}
                onChange={(e) => set({ category: e.target.value })}
                placeholder="e.g. Cleaning, Opening, Office"
              />
              <datalist id="todo-category-options">
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground mt-1">
                To-dos with the same category are grouped together.
              </p>
            </div>

            {/* Recurrence */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Repeats</Label>
                <Select value={draft.recurrence} onValueChange={(v) => set({ recurrence: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_off">One-off</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due time (optional)</Label>
                <Input
                  type="time"
                  value={draft.due_time || ""}
                  onChange={(e) => set({ due_time: e.target.value })}
                />
              </div>
            </div>

            {draft.recurrence === "one_off" && (
              <div>
                <Label>Due date (optional)</Label>
                <Input
                  type="date"
                  value={draft.due_date || ""}
                  onChange={(e) => set({ due_date: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty for an anytime task — it shows under Today until done.
                </p>
              </div>
            )}

            {draft.recurrence === "weekly" && (
              <div>
                <Label>Days of week</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleArr("recurrence_days", d)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                        (draft.recurrence_days || []).includes(d)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {draft.recurrence === "monthly" && (
              <div>
                <Label>Day of month</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.recurrence_day_of_month || 1}
                  onChange={(e) => set({ recurrence_day_of_month: e.target.value })}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Days past the month's length fall on the last day.
                </p>
              </div>
            )}

            {/* Assignees */}
            <div className="border-t pt-3">
              <Label className="text-sm font-semibold">Assign to</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Anyone matching any of these gets the to-do.
              </p>

              <div className="space-y-3">
                <div>
                  <Label className="text-xs">By role</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleArr("assignee_roles", r)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                          (draft.assignee_roles || []).includes(r)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/70"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {groups.length > 0 && (
                  <div>
                    <Label className="text-xs">Groups</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {groups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => toggleArr("group_ids", g.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            (draft.group_ids || []).includes(g.id)
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/70"
                          }`}
                        >
                          {g.name} ({g.member_emails?.length || 0})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs">Specific people</Label>
                  <MemberPicker
                    allUsers={allUsers}
                    selected={draft.assignee_emails || []}
                    onChange={(updater) =>
                      set({
                        assignee_emails:
                          typeof updater === "function"
                            ? updater(draft.assignee_emails || [])
                            : updater,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Notify */}
            <div className="border-t pt-3">
              <Label className="text-sm font-semibold flex items-center gap-1">
                <Bell className="h-4 w-4" /> Notify on completion
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                These people get an in-app notification each time it's completed.
              </p>
              <MemberPicker
                allUsers={allUsers}
                selected={draft.notify_emails || []}
                onChange={(updater) =>
                  set({
                    notify_emails:
                      typeof updater === "function"
                        ? updater(draft.notify_emails || [])
                        : updater,
                  })
                }
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.is_active !== false}
                onCheckedChange={(v) => set({ is_active: !!v })}
              />
              Active
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveTodo} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this to-do?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" and all its occurrences will be removed. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TodoCard({ todo, stats, due, archived = false, onEdit, onArchive, onRestore, onDelete }) {
  const s = stats || { pending: 0, completed: 0, overdue: 0 };
  return (
    <Card className={archived || !todo.is_active ? "opacity-60" : ""}>
      <CardContent className="p-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{todo.name}</h3>
            {!todo.is_active && !archived && <Badge variant="outline">Inactive</Badge>}
            {archived && todo.archived_at && (
              <Badge variant="outline">
                Archived {format(new Date(todo.archived_at), "MMM d")}
              </Badge>
            )}
          </div>
          {todo.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
              {todo.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Repeat className="h-3.5 w-3.5" /> {recurrenceLabel(todo)}
            </span>
            {!archived && due && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="h-3.5 w-3.5" /> next {due}
              </span>
            )}
            {todo.notify_emails?.length > 0 && (
              <span className="flex items-center gap-1">
                <Bell className="h-3.5 w-3.5" /> {todo.notify_emails.length} notified
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            {s.overdue > 0 && <Badge variant="destructive">{s.overdue} overdue</Badge>}
            <Badge variant="secondary">{s.pending} pending</Badge>
            <Badge variant="outline">{s.completed} done</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {archived ? (
            <Button variant="ghost" size="sm" onClick={onRestore}>
              <ArchiveRestore className="h-4 w-4 mr-1" /> Restore
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="icon" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" title="Archive" onClick={onArchive}>
                <Archive className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupsManager({ user, allUsers, groups, refetchGroups }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const openNew = () => {
    setEditingId(null);
    setName("");
    setMembers([]);
    setOpen(true);
  };
  const openEdit = (g) => {
    setEditingId(g.id);
    setName(g.name);
    setMembers(g.member_emails || []);
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name the group.");
      return;
    }
    try {
      const payload = {
        company_id: user.company_id,
        name: name.trim(),
        member_emails: members,
        created_by_email: user.email,
      };
      if (editingId) await base44.entities.TodoGroup.update(editingId, payload);
      else await base44.entities.TodoGroup.create(payload);
      toast.success("Group saved");
      setOpen(false);
      refetchGroups();
    } catch (e) {
      toast.error(e.message || "Could not save group");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await base44.entities.TodoGroup.delete(deleteTarget.id);
      toast.success("Group deleted");
      setDeleteTarget(null);
      refetchGroups();
    } catch (e) {
      toast.error(e.message || "Could not delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> New Group
        </Button>
      </div>

      {groups.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No groups yet. Groups are reusable sets of people you can assign to-dos to.</p>
        </div>
      )}

      <div className="grid gap-3">
        {groups.map((g) => (
          <Card key={g.id}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> {g.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {g.member_emails?.length || 0} member
                  {(g.member_emails?.length || 0) === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(g)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(g)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Group" : "New Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Members</Label>
              <MemberPicker allUsers={allUsers} selected={members} onChange={setMembers} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this group?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be removed. To-dos already assigned to it keep
              their existing occurrences.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
