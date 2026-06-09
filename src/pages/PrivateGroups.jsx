import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, BookOpen, MessageSquare, MessageCircle, Users, Lock, X } from "lucide-react";
import { toast } from "sonner";

const TYPES = [
  { key: "kb", label: "Knowledge Base Folder", icon: BookOpen, color: "text-amber-600" },
  { key: "forum", label: "Message Board", icon: MessageSquare, color: "text-blue-600" },
  { key: "chat", label: "Chat Channel", icon: MessageCircle, color: "text-green-600" },
];

function MemberPicker({ allUsers, selected, onChange, currentUserEmail }) {
  const [search, setSearch] = useState("");
  const filtered = allUsers.filter(u =>
    u.email !== currentUserEmail &&
    (u.full_name || u.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (email) => {
    onChange(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  };

  return (
    <div className="space-y-2">
      <Input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} />
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(email => {
            const u = allUsers.find(x => x.email === email);
            return (
              <span key={email} className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">
                {u?.full_name || email}
                <button onClick={() => toggle(email)}><X className="h-3 w-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto border rounded-lg p-1 space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">No employees found</p>
        ) : (
          filtered.map(u => (
            <label key={u.email} className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted cursor-pointer">
              <Checkbox checked={selected.includes(u.email)} onCheckedChange={() => toggle(u.email)} />
              <div>
                <p className="text-sm font-medium">{u.full_name || u.email}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function GroupCard({ item, type, onDelete, allUsers }) {
  const typeInfo = TYPES.find(t => t.key === type);
  const Icon = typeInfo.icon;
  const memberCount = item.authorized_emails?.length || 0;

  return (
    <div className="flex items-center justify-between p-4 border rounded-xl bg-card hover:bg-muted/20 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${typeInfo.color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm">{item.name}</p>
            <Lock className="h-3 w-3 text-muted-foreground" />
          </div>
          {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {(item.authorized_emails || []).map(email => {
              const u = allUsers.find(x => x.email === email);
              return (
                <Badge key={email} variant="outline" className="text-xs py-0">
                  {u?.full_name || email}
                </Badge>
              );
            })}
            {memberCount === 0 && <span className="text-xs text-muted-foreground">No members</span>}
          </div>
        </div>
      </div>
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive flex-shrink-0" onClick={() => onDelete(item)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function PrivateGroups() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState("kb");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: folders = [] } = useQuery({ queryKey: ["kb-folders"], queryFn: () => base44.entities.KBFolder.filter({ company_id: user.company_id }) });
  const { data: boards = [] } = useQuery({ queryKey: ["forum-boards"], queryFn: () => base44.entities.ForumBoard.filter({ company_id: user.company_id }) });
  const { data: channels = [] } = useQuery({ queryKey: ["chat-channels"], queryFn: () => base44.entities.ChatChannel.filter({ company_id: user.company_id }) });
  const { data: allUsers = [] } = useQuery({ queryKey: ["users"], queryFn: async () => { const res = await base44.functions.invoke("getCompanyUsers", {}); return res.data?.users || []; } });

  const privateFolders = folders.filter(f => f.authorized_emails?.length > 0);
  const privateBoards = boards.filter(b => b.authorized_emails?.length > 0);
  const privateChannels = channels.filter(c => c.authorized_emails?.length > 0);

  const openCreate = (type) => {
    setCreateType(type);
    setName("");
    setDescription("");
    setMembers([]);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const fnMap = {
      kb: "createPrivateKBFolder",
      forum: "createPrivateBoard",
      chat: "createPrivateChannel",
    };
    await base44.functions.invoke(fnMap[createType], {
      name: name.trim(),
      description: description.trim() || undefined,
      authorized_emails: members,
    });
    queryClient.invalidateQueries({ queryKey: ["kb-folders"] });
    queryClient.invalidateQueries({ queryKey: ["forum-boards"] });
    queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
    toast.success("Private group created");
    setCreateOpen(false);
    setSaving(false);
  };

  const handleDelete = async () => {
    const { item, type } = deleteTarget;
    const entityMap = { kb: "KBFolder", forum: "ForumBoard", chat: "ChatChannel" };
    const qkMap = { kb: ["kb-folders"], forum: ["forum-boards"], chat: ["chat-channels"] };
    await base44.entities[entityMap[type]].delete(item.id);
    queryClient.invalidateQueries({ queryKey: qkMap[type] });
    toast.success("Deleted");
    setDeleteTarget(null);
  };

  const isManagerOrAdmin = user?.role === "admin" || user?.role === "manager";

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Private Groups</h1>
          <p className="text-sm text-muted-foreground mt-1">Create restricted knowledge bases, message boards, and chat channels for specific employees</p>
        </div>
        {isManagerOrAdmin && (
          <Button onClick={() => openCreate("kb")}>
            <Plus className="h-4 w-4 mr-1.5" /> New Group
          </Button>
        )}
      </div>

      {!isManagerOrAdmin && (
        <div className="text-center py-12 text-muted-foreground">
          <Lock className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>Only managers and admins can manage private groups.</p>
        </div>
      )}

      {isManagerOrAdmin && (
        <>
          {[
            { type: "kb", label: "Knowledge Base Folders", items: privateFolders, icon: BookOpen, color: "text-amber-600" },
            { type: "forum", label: "Message Boards", items: privateBoards, icon: MessageSquare, color: "text-blue-600" },
            { type: "chat", label: "Chat Channels", items: privateChannels, icon: MessageCircle, color: "text-green-600" },
          ].map(({ type, label, items, icon: Icon, color }) => (
            <Card key={type}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${color}`} />
                    {label}
                    <Badge variant="outline" className="text-xs">{items.length}</Badge>
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => openCreate(type)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3 text-center">No private {label.toLowerCase()} yet</p>
                ) : (
                  items.map(item => (
                    <GroupCard
                      key={item.id}
                      item={item}
                      type={type}
                      allUsers={allUsers}
                      onDelete={(item) => setDeleteTarget({ item, type })}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Create Private {TYPES.find(t => t.key === createType)?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <div className="flex gap-2 mt-1.5">
                {TYPES.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setCreateType(t.key)}
                    className={`flex-1 flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs transition-colors ${
                      createType === t.key ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <t.icon className="h-4 w-4" />
                    {t.label.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Manager Updates, Store Leads Chat" autoFocus />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description..." />
            </div>
            <div>
              <Label className="mb-1.5 block">Members <span className="text-muted-foreground font-normal text-xs">(you'll be included automatically)</span></Label>
              <MemberPicker allUsers={allUsers} selected={members} onChange={setMembers} currentUserEmail={user?.email} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name.trim() || saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Private Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.item?.name}</strong>? This cannot be undone.
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