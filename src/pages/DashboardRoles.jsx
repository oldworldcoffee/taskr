import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";

const BASE_ROLE_LABELS = {
  employee: "Employee",
  supervisor: "Supervisor",
  manager: "Manager",
  admin: "Company Admin",
};

const MATRIX_MODULES = [
  { key: "inventory", label: "Inventory" },
  { key: "roastery", label: "Roastery" },
  { key: "financial", label: "Financial" },
];

const ROASTERY_PERMISSIONS = [
  { key: "view_production", label: "View production" },
  { key: "manage_production", label: "Manage production" },
  { key: "inventory_adjustments", label: "Inventory adjustments" },
  { key: "reporting", label: "Reporting" },
];

const EMPTY_DRAFT = () => ({
  id: null,
  label: "",
  base_role: "supervisor",
  modules: { inventory: { enabled: false }, roastery: { enabled: false, perms: {} }, financial: { enabled: false } },
});

function draftFromRole(role) {
  const modules = role.modules || {};
  return {
    id: role.id,
    label: role.label,
    base_role: role.base_role,
    modules: {
      inventory: { enabled: !!modules.inventory?.enabled },
      financial: { enabled: !!modules.financial?.enabled },
      roastery: { enabled: !!modules.roastery?.enabled, perms: modules.roastery?.roastery_perms || {} },
    },
  };
}

export default function DashboardRoles() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isManager = currentUser?.role === "manager";

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: roles = [] } = useQuery({
    queryKey: ["roles", currentUser?.company_id],
    queryFn: async () => {
      const res = await base44.functions.invoke("getRoles", {});
      return res.data?.roles || [];
    },
    enabled: !!currentUser,
  });

  const customRoles = roles.filter((r) => !r.is_system);

  // Managers can't create/edit admin-level roles.
  const baseRoleOptions = Object.keys(BASE_ROLE_LABELS).filter((k) => (isManager ? k !== "admin" : true));

  const setModule = (moduleKey, patch) => {
    setDraft((d) => ({ ...d, modules: { ...d.modules, [moduleKey]: { ...d.modules[moduleKey], ...patch } } }));
  };

  const handleSave = async () => {
    if (!draft.label.trim()) {
      toast.error("Role name is required");
      return;
    }
    setSaving(true);
    try {
      const modules = [
        { module: "inventory", enabled: draft.modules.inventory.enabled },
        { module: "financial", enabled: draft.modules.financial.enabled },
        { module: "roastery", enabled: draft.modules.roastery.enabled, roastery_perms: draft.modules.roastery.perms },
      ];
      await base44.functions.invoke("saveRole", {
        data: { id: draft.id, label: draft.label.trim(), base_role: draft.base_role, modules },
      });
      toast.success(draft.id ? "Role updated" : "Role created");
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    } catch (error) {
      toast.error(error.message || "Could not save role");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await base44.functions.invoke("deleteRole", { data: { id: deleteTarget.id } });
      toast.success("Role deleted");
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    } catch (error) {
      toast.error(error.message || "Could not delete role");
    } finally {
      setDeleteTarget(null);
    }
  };

  const moduleSummary = (role) => {
    const mods = MATRIX_MODULES.filter((m) => role.modules?.[m.key]?.enabled).map((m) => m.label);
    return mods.length ? mods.join(", ") : "Checklists only";
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Custom roles are templates of default module access. Assign them to employees, then fine-tune per location.
          </p>
        </div>
        <Button onClick={() => setDraft(EMPTY_DRAFT())}>
          <Plus className="h-4 w-4 mr-1.5" /> New Role
        </Button>
      </div>

      {/* System roles (read-only reference) */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Built-in Roles</h2>
        <Card>
          <CardContent className="p-4 grid sm:grid-cols-2 gap-3">
            {roles.filter((r) => r.is_system && r.key !== "super_admin").map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{moduleSummary(r)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Custom roles */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Custom Roles</h2>
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {customRoles.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-10">
                No custom roles yet. Create one to define a reusable access template.
              </p>
            )}
            {customRoles.map((role) => (
              <div key={role.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{role.label}</p>
                    <Badge variant="outline" className="text-xs">Acts as {BASE_ROLE_LABELS[role.base_role] || role.base_role}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{moduleSummary(role)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setDraft(draftFromRole(role))}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(role)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={!!draft} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit Role" : "New Role"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-5">
              <div>
                <Label>Role name</Label>
                <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Shift Lead" autoFocus />
              </div>
              <div>
                <Label className="text-sm font-semibold mb-2 block">Acts as</Label>
                <p className="text-xs text-muted-foreground mb-2">Controls dashboard routing and authorization. Module defaults are set below.</p>
                <div className="flex flex-wrap gap-2">
                  {baseRoleOptions.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setDraft({ ...draft, base_role: k })}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${draft.base_role === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                    >
                      {BASE_ROLE_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-sm font-semibold mb-2 block">Default Module Access</Label>
                <div className="space-y-1">
                  {MATRIX_MODULES.map((m) => (
                    <div key={m.key}>
                      <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 cursor-pointer">
                        <Checkbox
                          checked={!!draft.modules[m.key].enabled}
                          onCheckedChange={(c) => setModule(m.key, { enabled: !!c })}
                        />
                        <span className="text-sm">{m.label}</span>
                      </label>
                      {m.key === "roastery" && draft.modules.roastery.enabled && (
                        <div className="ml-7 border-l border-border pl-3 space-y-1">
                          {ROASTERY_PERMISSIONS.map((p) => (
                            <label key={p.key} className="flex items-center gap-3 py-1 cursor-pointer">
                              <Checkbox
                                checked={!!draft.modules.roastery.perms?.[p.key]}
                                onCheckedChange={(c) => setModule("roastery", { perms: { ...(draft.modules.roastery.perms || {}), [p.key]: !!c } })}
                              />
                              <span className="text-xs">{p.label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Checklists are always enabled for every role.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Role"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.label}</strong>? Employees currently assigned this role must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
