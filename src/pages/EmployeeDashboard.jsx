import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";
import { useMyTodos } from "@/hooks/useMyTodos";
import MyTodos from "@/components/todos/MyTodos";
import { Calendar, ListChecks, ClipboardList, MessageSquare, MessageCircle, ChevronRight } from "lucide-react";

function DashCard({ to, icon: Icon, label, value, sub, accent, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="group flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:border-primary/40 hover:bg-muted/20 transition-colors"
    >
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${accent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">{label}</p>
        <p className="text-xs text-muted-foreground leading-tight">{sub}</p>
      </div>
      {value > 0 ? (
        <span className="h-6 min-w-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
          {value}
        </span>
      ) : (
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
      )}
    </Link>
  );
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { unreadChat, unreadForum, markForumSeen } = useUnreadCounts();
  const { dueCount } = useMyTodos();

  const assignedLocations = user?.assigned_locations || [];

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: user.company_id, is_active: true }),
    enabled: !!user?.company_id,
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ["checklists"],
    queryFn: () => base44.entities.Checklist.filter({ company_id: user.company_id, is_active: true }),
    enabled: !!user?.company_id,
  });

  const locationIds = (assignedLocations.length > 0
    ? locations.filter((l) => assignedLocations.includes(l.id))
    : locations
  ).map((l) => l.id);

  const myChecklists = checklists.filter(
    (c) => locationIds.length === 0 || locationIds.includes(c.location_id)
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Calendar className="h-4 w-4" />
          <span className="text-sm font-medium">{format(new Date(), "EEEE, MMMM d")}</span>
        </div>
        <h2 className="text-2xl font-bold">Hi, {(user?.full_name || user?.email || "there").split(" ")[0]}</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DashCard
          to="/my-todos"
          icon={ListChecks}
          label="My To-Dos"
          sub={dueCount > 0 ? `${dueCount} due now` : "Nothing due"}
          value={dueCount}
          accent
        />
        <DashCard
          to="/checklists"
          icon={ClipboardList}
          label="My Checklists"
          sub={`${myChecklists.length} list${myChecklists.length === 1 ? "" : "s"} today`}
          value={0}
          accent
        />
        <DashCard
          to="/forum"
          icon={MessageSquare}
          label="Message Board"
          sub={unreadForum > 0 ? `${unreadForum} new` : "Up to date"}
          value={unreadForum}
          onClick={markForumSeen}
        />
        <DashCard
          to="/chat"
          icon={MessageCircle}
          label="Chat"
          sub={unreadChat > 0 ? `${unreadChat} new` : "Up to date"}
          value={unreadChat}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" /> My Tasks
          </h3>
          <Link to="/my-todos" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
        <MyTodos compact />
      </div>
    </div>
  );
}
