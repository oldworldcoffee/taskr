import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import UserAvatar from "@/components/shared/UserAvatar";
import { Plus, Settings2, Mail, RefreshCw, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";

const roleConfig = {
  admin:      { label: "Company Admin", className: "bg-primary/10 text-primary border-primary/20" },
  manager:    { label: "Manager",       className: "bg-blue-50 text-blue-700 border-blue-200" },
  supervisor: { label: "Supervisor",    className: "bg-purple-50 text-purple-700 border-purple-200" },
  employee:   { label: "Employee",      className: "bg-muted text-muted-foreground border-border" },
};

const SYSTEM_ROLES = [
  { value: "employee",   label: "Employee",      description: "Can only access the employee checklist view" },
  { value: "supervisor", label: "Supervisor",    description: "Routes to employee view; dashboard access to Checklists & KB" },
  { value: "manager",    label: "Manager",       description: "Dashboard access: Checklists, Employees, KB, Forum, Chat" },
  { value: "admin",      label: "Company Admin", description: "Full access including Settings, Private Groups, and Billing" },
];

// Roles whose holders auto-grant every module everywhere (no per-location matrix).
const AUTO_GRANT_BASE = new Set(["admin", "manager", "super_admin"]);

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

const INVENTORY_PERMISSIONS = [
  { key: "take_inventory", label: "Take inventory" },
  { key: "place_orders", label: "Place orders" },
  { key: "intake_invoices", label: "Intake invoices" },
  { key: "manage_pools", label: "Manage pools" },
  { key: "manage_catalog", label: "Manage catalog" },
];

// Pre-checked actions when an admin first enables inventory for a user:
// day-to-day operations on; pools/catalog stay manager-level unless granted.
const INVENTORY_DEFAULT_PERMS = { take_inventory: true, place_orders: true, intake_invoices: true };

const MODULE_SUB_PERMS = { inventory: INVENTORY_PERMISSIONS, roastery: ROASTERY_PERMISSIONS };

// A role "token" encodes whether it is a system role (sys:<key>) or a custom
// role (custom:<id>). Selecting a token yields { role: <base role>, role_id }.
function buildRoleOptions(customRoles = []) {
  const system = SYSTEM_ROLES.map((r) => ({
    token: `sys:${r.value}`,
    label: r.label,
    description: r.description,
    role: r.value,
    role_id: null,
    base_role: r.value,
  }));
  const custom = customRoles
    .filter((r) => !r.is_system)
    .map((r) => ({
      token: `custom:${r.id}`,
      label: r.label,
      description: `Custom role — acts as ${roleConfig[r.base_role]?.label || r.base_role}`,
      role: r.base_role,
      role_id: r.id,
      base_role: r.base_role,
    }));
  return [...system, ...custom];
}

function tokenForUser(user) {
  return user?.role_id ? `custom:${user.role_id}` : `sys:${user?.role || "employee"}`;
}

const RoleSelector = ({ value, onChange, options, isManager }) => (
  <div className="space-y-2">
    {options
      .filter((o) => (isManager ? o.base_role !== "admin" : true))
      .map((o) => (
        <button
          key={o.token}
          type="button"
          onClick={() => onChange(o)}
          className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${
            value === o.token ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
          }`}
        >
          <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
            value === o.token ? "border-primary" : "border-muted-foreground/40"
          }`}>
            {value === o.token && <div className="w-2 h-2 rounded-full bg-primary" />}
          </div>
          <div>
            <p className="text-sm font-medium">{o.label}</p>
            <p className="text-xs text-muted-foreground">{o.description}</p>
          </div>
        </button>
      ))}
  </div>
);

const LocationSelector = ({ selected, onChange, locations }) => {
  const toggle = (id) => onChange(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  return (
    <div className="space-y-2">
      {locations.map((loc) => (
        <label key={loc.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 cursor-pointer">
          <Checkbox checked={selected.includes(loc.id)} onCheckedChange={() => toggle(loc.id)} />
          <span className="text-sm">{loc.name}</span>
          {loc.address && <span className="text-xs text-muted-foreground truncate">{loc.address}</span>}
        </label>
      ))}
    </div>
  );
};

// Per-(location, module) access grid. `cells` is a flat list keyed by
// `${location_id}:${module}`; edits are lifted to the parent via onChange.
// Inventory and roastery expand into action-level checkboxes when enabled.
const ModuleMatrix = ({ cells, locations, onChange }) => {
  const cellFor = (locationId, module) =>
    cells.find((c) => c.location_id === locationId && c.module === module) ||
    { location_id: locationId, module, enabled: false, perms: {}, source: "role_default" };

  const setCell = (locationId, module, patch) => {
    const existing = cellFor(locationId, module);
    const next = { ...existing, ...patch, source: "override" };
    onChange([
      ...cells.filter((c) => !(c.location_id === locationId && c.module === module)),
      next,
    ]);
  };

  const toggleModule = (locationId, module, checked) => {
    const patch = { enabled: checked };
    if (checked && module === "inventory") {
      const existing = cellFor(locationId, module);
      // Seed sensible defaults the first time inventory is enabled here.
      if (!Object.values(existing.perms || {}).some(Boolean)) {
        patch.perms = { ...INVENTORY_DEFAULT_PERMS };
      }
    }
    setCell(locationId, module, patch);
  };

  if (!locations.length) {
    return <p className="text-xs text-muted-foreground">No active locations to configure.</p>;
  }

  return (
    <div className="space-y-3">
      {locations.map((loc) => (
        <div key={loc.id} className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium mb-2">{loc.name}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {MATRIX_MODULES.map((m) => {
              const cell = cellFor(loc.id, m.key);
              return (
                <label key={m.key} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={!!cell.enabled}
                    onCheckedChange={(c) => toggleModule(loc.id, m.key, !!c)}
                  />
                  <span className="text-sm">{m.label}</span>
                </label>
              );
            })}
          </div>
          {MATRIX_MODULES.filter((m) => MODULE_SUB_PERMS[m.key] && cellFor(loc.id, m.key).enabled).map((m) => {
            const cell = cellFor(loc.id, m.key);
            return (
              <div key={m.key} className="mt-2 ml-1 border-l border-border pl-3">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{m.label} actions</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {MODULE_SUB_PERMS[m.key].map((p) => (
                    <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={!!cell.perms?.[p.key]}
                        onCheckedChange={(c) =>
                          setCell(loc.id, m.key, {
                            enabled: true,
                            perms: { ...(cell.perms || {}), [p.key]: !!c },
                          })
                        }
                      />
                      <span className="text-xs">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default function DashboardEmployees() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isManager = currentUser?.role === "manager";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRoleToken, setInviteRoleToken] = useState("sys:employee");
  const [inviteLocations, setInviteLocations] = useState([]);
  const [inviting, setInviting] = useState(false);

  const [editUser, setEditUser] = useState(null);
  const [editRoleToken, setEditRoleToken] = useState("sys:employee");
  const [editLocations, setEditLocations] = useState([]);
  const [matrixCells, setMatrixCells] = useState([]);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resending, setResending] = useState(null);

  const { data: users = [] } = useQuery({
    queryKey: ["all-users", currentUser?.company_id],
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyUsers", {});
      return res.data?.users || [];
    },
    enabled: !!currentUser,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: currentUser.company_id }),
  });

  const { data: customRoles = [] } = useQuery({
    queryKey: ["roles", currentUser?.company_id],
    queryFn: async () => {
      const res = await base44.functions.invoke("getRoles", {});
      return res.data?.roles || [];
    },
    enabled: !!currentUser,
  });

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites"],
    queryFn: () => base44.entities.PendingInvite.filter({ company_id: currentUser.company_id }),
  });

  const roleOptions = buildRoleOptions(customRoles);
  const optionByToken = (token) => roleOptions.find((o) => o.token === token) || roleOptions[0];

  const activeLocations = locations.filter(l => l.is_active);
  const registeredEmails = new Set(users.map(u => u.email?.toLowerCase()));
  const activePendingInvites = pendingInvites.filter(inv => !registeredEmails.has(inv.email?.toLowerCase()));

  const employeeStats = users;

  const getLocationNames = (ids = []) => {
    if (!ids.length) return "All locations";
    return ids.map(id => locations.find(l => l.id === id)?.name).filter(Boolean).join(", ");
  };

  const roleBadge = (user) => {
    const custom = user.role_id ? customRoles.find((r) => r.id === user.role_id) : null;
    const baseKey = user.role || "employee";
    return {
      label: custom?.label || roleConfig[baseKey]?.label || baseKey,
      className: roleConfig[baseKey]?.className,
    };
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    const opt = optionByToken(inviteRoleToken);
    setInviting(true);
    try {
      await base44.users.inviteUser({
        email,
        name: inviteName.trim(),
        role: opt.role,
        role_id: opt.role_id,
        assigned_locations: inviteLocations,
      });
      toast.success(`Invite sent to ${email}`);
      setInviteEmail("");
      setInviteName("");
      setInviteRoleToken("sys:employee");
      setInviteLocations([]);
      setInviteOpen(false);
    } catch (error) {
      toast.error(error.message || "Invite could not be sent");
    } finally {
      setInviting(false);
      queryClient.invalidateQueries({ queryKey: ["all-users"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    }
  };

  const handleResend = async (invite) => {
    setResending(invite.id);
    try {
      await base44.users.inviteUser({
        email: invite.email,
        name: invite.name || "",
        role: invite.role || "employee",
        role_id: invite.role_id || null,
        assigned_locations: invite.assigned_locations || [],
        resend: true,
      });
      toast.success(`Invite resent to ${invite.email}`);
    } catch (error) {
      toast.error(error.message || "Invite could not be resent");
    } finally {
      setResending(null);
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    }
  };

  const handleDeletePending = async (invite) => {
    await base44.entities.PendingInvite.delete(invite.id);
    queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    toast.success("Pending invite removed");
  };

  const openEdit = async (user) => {
    setEditUser(user);
    setEditRoleToken(tokenForUser(user));
    setEditLocations(user.assigned_locations || []);
    setMatrixCells([]);
    setMatrixLoading(true);
    try {
      const res = await base44.functions.invoke("getUserModuleAccess", { data: { userId: user.id } });
      setMatrixCells(res.data?.cells || []);
    } catch (error) {
      toast.error(error.message || "Could not load module access");
    } finally {
      setMatrixLoading(false);
    }
  };

  const editOption = optionByToken(editRoleToken);
  const editIsAutoGrant = AUTO_GRANT_BASE.has(editOption?.base_role);

  const handleSavePermissions = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      // Role + location assignment + custom-role pointer (client-direct, RLS-gated).
      await base44.entities.User.update(editUser.id, {
        role: editOption.role,
        role_id: editOption.role_id,
        assigned_locations: editLocations,
      });

      // Per-location module matrix (service-role edge function). Skip for
      // auto-grant roles — they get everything by role.
      if (!editIsAutoGrant) {
        const entries = matrixCells
          .filter((c) => c.module !== "task_checklist")
          .map((c) => ({
            location_id: c.location_id,
            module: c.module,
            enabled: !!c.enabled,
            perms: c.perms || {},
          }));
        await base44.functions.invoke("saveUserModuleAccess", {
          data: { userId: editUser.id, entries },
        });
      }

      queryClient.invalidateQueries({ queryKey: ["all-users"] });
      toast.success("Permissions updated");
      setEditUser(null);
    } catch (error) {
      toast.error(error.message || "Could not save permissions");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    await base44.entities.User.delete(deleteTarget.id);
    queryClient.invalidateQueries({ queryKey: ["all-users"] });
    toast.success("User removed");
    setDeleteTarget(null);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-muted-foreground mt-1">Invite employees and manage their access permissions</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Invite Employee
        </Button>
      </div>

      {/* Active Employees */}
      <Card>
        <CardContent className="p-0">
          <div className="rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="font-semibold">Employee</TableHead>
                  <TableHead className="font-semibold">Role</TableHead>
                  <TableHead className="font-semibold">Location Access</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeStats.map((emp) => {
                  const badge = roleBadge(emp);
                  return (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <UserAvatar name={emp.full_name} email={emp.email} size="sm" />
                          <div>
                            <p className="font-medium text-sm">{emp.full_name || emp.email}</p>
                            <p className="text-xs text-muted-foreground">{emp.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs capitalize ${badge.className}`}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {getLocationNames(emp.assigned_locations)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!(isManager && emp.role === "admin") && (
                            <>
                              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openEdit(emp)}>
                                <Settings2 className="h-3.5 w-3.5" /> Permissions
                              </Button>
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(emp)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {employeeStats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      No employees yet. Invite your first team member above.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {activePendingInvites.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Pending Invites
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="font-semibold">Email</TableHead>
                      <TableHead className="font-semibold">Role</TableHead>
                      <TableHead className="font-semibold">Location Access</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activePendingInvites.map((inv) => (
                      <TableRow key={inv.id} className="opacity-70">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div>
                              {inv.name && <p className="text-sm font-medium">{inv.name}</p>}
                              <p className="text-sm text-muted-foreground">{inv.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs capitalize ${roleConfig[inv.role || "employee"]?.className}`}>
                            {roleConfig[inv.role || "employee"]?.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {getLocationNames(inv.assigned_locations)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm" variant="ghost" className="gap-1.5 text-xs"
                              disabled={resending === inv.id}
                              onClick={() => handleResend(inv)}
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${resending === inv.id ? "animate-spin" : ""}`} />
                              {resending === inv.id ? "Sending..." : "Resend"}
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeletePending(inv)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Invite Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <Label>Full name</Label>
              <Input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Jane Smith"
                autoFocus
              />
            </div>
            <div>
              <Label>Email address</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="employee@example.com"
              />
            </div>
            <div>
              <Label className="text-sm font-semibold mb-2 block">Role</Label>
              <RoleSelector value={inviteRoleToken} onChange={(o) => setInviteRoleToken(o.token)} options={roleOptions} isManager={isManager} />
            </div>
            {activeLocations.length > 0 && (
              <div>
                <Label className="text-sm font-semibold mb-1 block">Location Access</Label>
                <p className="text-xs text-muted-foreground mb-2">Leave all unchecked to grant access to all locations.</p>
                <LocationSelector selected={inviteLocations} onChange={setInviteLocations} locations={activeLocations} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
              {inviting ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permissions — {editUser?.full_name || editUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <Label className="text-sm font-semibold mb-2 block">Role & Dashboard Access</Label>
              <RoleSelector value={editRoleToken} onChange={(o) => setEditRoleToken(o.token)} options={roleOptions} isManager={isManager} />
            </div>
            <div>
              <Label className="text-sm font-semibold mb-1 block">Location Access</Label>
              <p className="text-xs text-muted-foreground mb-2">Leave all unchecked to grant access to all locations.</p>
              <LocationSelector selected={editLocations} onChange={setEditLocations} locations={activeLocations} />
            </div>
            <div>
              <Label className="text-sm font-semibold mb-1 block">Module Access by Location</Label>
              {editIsAutoGrant ? (
                <p className="text-xs text-muted-foreground">
                  Admins and managers already have full access to every module at every location by role.
                </p>
              ) : matrixLoading ? (
                <p className="text-xs text-muted-foreground">Loading module access…</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-2">
                    Enable modules per location. Checklists are always on. Inventory and Roastery expand into
                    action-level permissions when enabled.
                  </p>
                  <ModuleMatrix cells={matrixCells} locations={activeLocations} onChange={setMatrixCells} />
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSavePermissions} disabled={saving || matrixLoading}>
              {saving ? "Saving..." : "Save Permissions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleDeleteUser}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
