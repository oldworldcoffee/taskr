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

const ALL_ROLES = [
  { value: "employee",   label: "Employee",      description: "Can only access the employee checklist view" },
  { value: "supervisor", label: "Supervisor",    description: "Routes to employee view; dashboard access to Checklists & KB" },
  { value: "manager",    label: "Manager",       description: "Dashboard access: Checklists, Employees, KB, Forum, Chat" },
  { value: "admin",      label: "Company Admin", description: "Full access including Settings, Private Groups, and Billing" },
];

const RoleSelector = ({ value, onChange, isManager }) => (
  <div className="space-y-2">
    {ALL_ROLES.filter(r => isManager ? r.value !== "admin" : true).map((r) => (
      <button
        key={r.value}
        type="button"
        onClick={() => onChange(r.value)}
        className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${
          value === r.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
        }`}
      >
        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
          value === r.value ? "border-primary" : "border-muted-foreground/40"
        }`}>
          {value === r.value && <div className="w-2 h-2 rounded-full bg-primary" />}
        </div>
        <div>
          <p className="text-sm font-medium">{r.label}</p>
          <p className="text-xs text-muted-foreground">{r.description}</p>
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

const ROASTERY_PERMISSIONS = [
  { key: "view_production", label: "View production" },
  { key: "manage_production", label: "Manage production" },
  { key: "inventory_adjustments", label: "Inventory adjustments" },
  { key: "reporting", label: "Reporting" },
];

// Per-user feature grants (users.feature_permissions). Admins/managers already
// get everything by role; these grants extend access to supervisors/employees.
const FeatureAccessSelector = ({ value, onChange }) => {
  const features = value || {};
  const roastery = (features.roastery && typeof features.roastery === "object") ? features.roastery : {};
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 cursor-pointer">
        <Checkbox checked={!!features.inventory} onCheckedChange={(c) => onChange({ ...features, inventory: !!c })} />
        <span className="text-sm">Inventory</span>
      </label>
      <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 cursor-pointer">
        <Checkbox checked={!!features.financial} onCheckedChange={(c) => onChange({ ...features, financial: !!c })} />
        <span className="text-sm">Financial Management</span>
      </label>
      <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 cursor-pointer">
        <Checkbox checked={!!roastery.enabled} onCheckedChange={(c) => onChange({ ...features, roastery: { ...roastery, enabled: !!c } })} />
        <span className="text-sm">Roastery</span>
      </label>
      {roastery.enabled && (
        <div className="ml-7 space-y-1 border-l border-border pl-3">
          {ROASTERY_PERMISSIONS.map((p) => (
            <label key={p.key} className="flex items-center gap-3 py-1 cursor-pointer">
              <Checkbox checked={!!roastery[p.key]} onCheckedChange={(c) => onChange({ ...features, roastery: { ...roastery, enabled: true, [p.key]: !!c } })} />
              <span className="text-xs">{p.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default function DashboardEmployees() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("employee");
  const [inviteLocations, setInviteLocations] = useState([]);
  const [inviting, setInviting] = useState(false);

  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState("employee");
  const [editLocations, setEditLocations] = useState([]);
  const [editFeatures, setEditFeatures] = useState({});
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

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites"],
    queryFn: () => base44.entities.PendingInvite.filter({ company_id: currentUser.company_id }),
  });

  const activeLocations = locations.filter(l => l.is_active);
  const registeredEmails = new Set(users.map(u => u.email?.toLowerCase()));
  const activePendingInvites = pendingInvites.filter(inv => !registeredEmails.has(inv.email?.toLowerCase()));

  const employeeStats = users;

  const getLocationNames = (ids = []) => {
    if (!ids.length) return "All locations";
    return ids.map(id => locations.find(l => l.id === id)?.name).filter(Boolean).join(", ");
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      await base44.users.inviteUser({
        email,
        name: inviteName.trim(),
        role: inviteRole,
        assigned_locations: inviteLocations,
      });
      toast.success(`Invite sent to ${email}`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("employee");
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

  const openEdit = (user) => {
    setEditUser(user);
    setEditRole(user.role || "employee");
    setEditLocations(user.assigned_locations || []);
    setEditFeatures(user.feature_permissions && typeof user.feature_permissions === "object" ? user.feature_permissions : {});
  };

  const handleSavePermissions = async () => {
    setSaving(true);
    await base44.entities.User.update(editUser.id, {
      role: editRole,
      assigned_locations: editLocations,
      feature_permissions: editFeatures,
    });
    queryClient.invalidateQueries({ queryKey: ["all-users"] });
    toast.success("Permissions updated");
    setSaving(false);
    setEditUser(null);
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
                {employeeStats.map((emp) => (
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
                      <Badge variant="outline" className={`text-xs capitalize ${roleConfig[emp.role || "employee"]?.className}`}>
                        {roleConfig[emp.role || "employee"]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {getLocationNames(emp.assigned_locations)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!(currentUser?.role === "manager" && emp.role === "admin") && (
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
                ))}
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
              <RoleSelector value={inviteRole} onChange={setInviteRole} isManager={currentUser?.role === "manager"} />
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Permissions — {editUser?.full_name || editUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <Label className="text-sm font-semibold mb-2 block">Role & Dashboard Access</Label>
              <RoleSelector value={editRole} onChange={setEditRole} isManager={currentUser?.role === "manager"} />
            </div>
            <div>
              <Label className="text-sm font-semibold mb-1 block">Location Access</Label>
              <p className="text-xs text-muted-foreground mb-2">Leave all unchecked to grant access to all locations.</p>
              <LocationSelector selected={editLocations} onChange={setEditLocations} locations={activeLocations} />
            </div>
            <div>
              <Label className="text-sm font-semibold mb-1 block">Feature Access</Label>
              <p className="text-xs text-muted-foreground mb-2">
                {["admin", "manager"].includes(editRole)
                  ? "Admins and managers already have full feature access by role."
                  : "Grant Inventory or Roastery access to this user."}
              </p>
              <FeatureAccessSelector value={editFeatures} onChange={setEditFeatures} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSavePermissions} disabled={saving}>
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
