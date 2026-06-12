import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  PackageCheck,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import MyTodos from "@/components/todos/MyTodos";

function MetricCard({ title, value, description, icon: Icon, to, muted = false }) {
  const card = (
    <Card className={`h-full transition-colors ${to ? "hover:border-primary/40" : ""} ${muted ? "bg-muted/30" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );

  if (!to) return card;

  return (
    <Link to={to} className="block h-full">
      {card}
    </Link>
  );
}

function QuickLink({ to, icon: Icon, label }) {
  return (
    <Button asChild variant="outline" className="justify-start gap-2">
      <Link to={to}>
        <Icon className="h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}

export default function OperationsHome() {
  const { user } = useAuth();
  const { unreadChat, unreadForum } = useUnreadCounts();
  const today = format(new Date(), "yyyy-MM-dd");
  const canManage = ["admin", "manager", "super_admin"].includes(user?.role);

  const { data: company } = useQuery({
    queryKey: ["company-info"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyInfo", {});
      return res.data.success ? res.data.company : null;
    },
    enabled: !!user?.company_id,
  });

  const { data: todayInstances = [] } = useQuery({
    queryKey: ["operations-home-instances", user?.company_id, today],
    queryFn: () => base44.entities.ChecklistInstance.filter({ company_id: user.company_id, date: today }),
    enabled: !!user?.company_id,
  });

  const { data: recentFlags = [] } = useQuery({
    queryKey: ["operations-home-flags", user?.company_id],
    queryFn: () => base44.entities.TaskCompletion.filter({ company_id: user.company_id, is_flag: true }, "-created_date", 25),
    enabled: !!user?.company_id,
  });

  const inventoryEnabled = (company?.enabled_features || []).includes("inventory") && canManage;

  const { data: pendingOrders = [] } = useQuery({
    queryKey: ["operations-home-inventory-orders", user?.company_id],
    queryFn: () => base44.entities.Order.filter(
      { company_id: user.company_id, status: { $in: ["draft", "sent", "viewed"] } },
      "-created_date",
      25
    ),
    enabled: !!user?.company_id && inventoryEnabled,
  });

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["operations-home-inventory-invoices", user?.company_id],
    queryFn: () => base44.entities.Invoice.filter(
      { company_id: user.company_id, status: "pending_review" },
      "-created_date",
      25
    ),
    enabled: !!user?.company_id && inventoryEnabled,
  });

  const completed = todayInstances.filter((item) => item.status === "completed").length;
  const inProgress = todayInstances.filter((item) => item.status === "in_progress").length;
  const notStarted = todayInstances.filter((item) => item.status === "not_started").length;
  const flagged = todayInstances.filter((item) => item.status === "incomplete_flagged").length;
  const total = todayInstances.length;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const unreadTotal = (unreadChat || 0) + (unreadForum || 0);
  const pendingInventory = pendingOrders.length + pendingInvoices.length;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Operations Home</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Today's snapshot across checklists, inventory, and team activity.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMM d")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Checklist Health"
          value={total ? `${completionRate}%` : "No runs"}
          description={total ? `${completed} of ${total} completed today` : "No checklist instances scheduled today"}
          icon={CheckCircle2}
          to="/dashboard/checklists/overview"
        />
        <MetricCard
          title="Open Signals"
          value={flagged + recentFlags.length}
          description={`${flagged} checklist runs flagged today, ${recentFlags.length} recent flagged tasks`}
          icon={AlertTriangle}
          to="/dashboard/issues"
        />
        <MetricCard
          title="Inventory"
          value={inventoryEnabled ? (pendingInventory ? pendingInventory : "Ready") : "Off"}
          description={inventoryEnabled ? `${pendingOrders.length} orders and ${pendingInvoices.length} invoices need attention` : "Enable Inventory from company settings"}
          icon={PackageCheck}
          to={inventoryEnabled ? "/dashboard/inventory" : undefined}
          muted={!inventoryEnabled}
        />
        <MetricCard
          title="Team Hub"
          value={unreadTotal}
          description={unreadTotal ? "Unread message board and chat activity" : "No unread team activity"}
          icon={MessageCircle}
          to="/dashboard/chat"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Tasks</CardTitle>
          <CardDescription>Your to-dos due now and coming up.</CardDescription>
        </CardHeader>
        <CardContent>
          <MyTodos title="My Tasks" compact />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Checklist Pulse</CardTitle>
            <CardDescription>Today's run status across all active locations.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="text-xl font-semibold">{completed}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">In Progress</p>
              <p className="text-xl font-semibold">{inProgress}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Not Started</p>
              <p className="text-xl font-semibold">{notStarted}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Flagged</p>
              <p className="text-xl font-semibold">{flagged}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Links</CardTitle>
            <CardDescription>Common manager workflows.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <QuickLink to="/dashboard/todos" icon={ClipboardList} label="To-Dos" />
            <QuickLink to="/dashboard/checklists/overview" icon={ClipboardList} label="Checklist Overview" />
            <QuickLink to="/dashboard/issues" icon={AlertTriangle} label="Issues & Flags" />
            {inventoryEnabled && <QuickLink to="/dashboard/inventory" icon={PackageCheck} label="Inventory" />}
            <QuickLink to="/dashboard/knowledge-base" icon={BookOpen} label="Knowledge Base" />
            {canManage && <QuickLink to="/dashboard/equipment" icon={Wrench} label="Equipment" />}
            {canManage && <QuickLink to="/dashboard/employees" icon={Users} label="Employees" />}
            {user?.role === "admin" && <QuickLink to="/dashboard/settings" icon={Settings} label="Settings" />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
