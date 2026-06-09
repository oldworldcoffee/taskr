import { Outlet, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, AlertTriangle, Users, Settings, LogOut, Coffee, Menu, UserCircle, BookOpen, MessageSquare, MessageCircle, Search, Lock, ClipboardList, ChevronRight, Wrench } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useBrandSettings } from "@/hooks/useBrandSettings";
import { useQuery } from "@tanstack/react-query";
import GlobalSearch from "@/components/shared/GlobalSearch";
import TrialBanner from "@/components/shared/TrialBanner";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";

const checklistItems = [
  { path: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { path: "/dashboard/issues", label: "Issues & Flags", icon: AlertTriangle },
  { path: "/dashboard/checklists/setup", label: "Setup", icon: Wrench },
];

const navItems = [
  { path: "/dashboard/employees", label: "Employees", icon: Users, roles: ["admin", "manager"] },
  { path: "/dashboard/equipment", label: "Equipment", icon: Wrench, roles: ["admin", "manager"] },
  { path: "/dashboard/knowledge-base", label: "Knowledge Base", icon: BookOpen, roles: ["admin", "manager", "supervisor"] },
  { path: "/dashboard/forum", label: "Message Board", icon: MessageSquare, roles: ["admin", "manager"] },
  { path: "/dashboard/chat", label: "Chat", icon: MessageCircle, roles: ["admin", "manager"] },
  { path: "/dashboard/private-groups", label: "Private Groups", icon: Lock, roles: ["admin"] },
  { path: "/dashboard/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];

function NavLinks({ isActive, onNavigate, user, unreadChat, unreadForum, markChatSeen, markForumSeen }) {
  const [checklistsOpen, setChecklistsOpen] = useState(true);
  const isChecklistActive = isActive("/dashboard") || isActive("/dashboard/issues") || isActive("/dashboard/checklists");
  const role = user?.role;

  return (
    <>
      {/* Checklists section */}
      <button
        onClick={() => setChecklistsOpen((o) => !o)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isChecklistActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        }`}
      >
        <ClipboardList className="h-4 w-4" />
        <span className="flex-1 text-left">Checklists</span>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${checklistsOpen ? "rotate-90" : ""}`} />
      </button>
      {checklistsOpen && (
        <div className="ml-4 pl-3 border-l border-sidebar-border/50 space-y-0.5">
          {checklistItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive(item.path)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          ))}
        </div>
      )}

      {/* Other nav items — filtered by role */}
      {navItems.filter(item => item.roles.includes(role)).map((item) => {
        const isChat = item.path === "/dashboard/chat";
        const isForum = item.path === "/dashboard/forum";
        const badge = isChat ? unreadChat : isForum ? unreadForum : 0;
        const handleClick = () => {
          if (isChat) markChatSeen();
          if (isForum) markForumSeen();
          onNavigate();
        };
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={handleClick}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive(item.path)
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            }`}
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1">{item.label}</span>
            {badge > 0 && (
              <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
      <Link
        to="/home"
        onClick={onNavigate}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      >
        <UserCircle className="h-4 w-4" />
        Switch to Employee View
      </Link>
      {user?.role === "super_admin" && (
        <Link
          to="/super-admin"
          onClick={onNavigate}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <Settings className="h-4 w-4" />
          Super Admin Panel
        </Link>
      )}
    </>
  );
}

function BrandMark({ small }) {
  const { data: brand } = useBrandSettings();
  const { data: company } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCompanyInfo', {});
      return res.data.success ? res.data.company : null;
    }
  });
  const name = brand?.business_name || company?.name || "OWCR Operations";
  const logo = brand?.logo_url;
  const size = small ? "h-9 w-9" : "h-10 w-10";
  return (
    <div className="flex items-center gap-3">
      <div className={`${size} rounded-xl bg-sidebar-primary flex items-center justify-center overflow-hidden`}>
        {logo
          ? <img src={logo} alt="logo" className="h-full w-full object-contain" />
          : <Coffee className={small ? "h-4 w-4 text-sidebar-primary-foreground" : "h-5 w-5 text-sidebar-primary-foreground"} />
        }
      </div>
      <div>
        <p className="font-bold text-sidebar-foreground text-sm">{name}</p>
        <p className="text-xs text-sidebar-foreground/60">Management Dashboard</p>
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  const location = useLocation();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: brand } = useBrandSettings();
  const { data: company } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCompanyInfo', {});
      return res.data.success ? res.data.company : null;
    }
  });

  const isActive = (path) => {
    if (path === "/dashboard") return location.pathname === "/dashboard";
    return location.pathname.startsWith(path);
  };

  const { unreadChat, unreadForum, markChatSeen, markForumSeen } = useUnreadCounts();

  // ⌘K / Ctrl+K to open search
  useState(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border relative overflow-hidden">
        <div className="p-5 border-b border-sidebar-border">
          <BrandMark />
        </div>

        <div className="px-3 pt-2">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/60 bg-sidebar-accent/30 hover:bg-sidebar-accent/60 transition-colors"
          >
            <Search className="h-4 w-4" />
            <span>Search...</span>
            <kbd className="ml-auto text-[10px] bg-sidebar-accent/60 px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <NavLinks isActive={isActive} onNavigate={() => {}} user={user} unreadChat={unreadChat} unreadForum={unreadForum} markChatSeen={markChatSeen} markForumSeen={markForumSeen} />
        </nav>

        {searchOpen && (
          <div className="absolute inset-0 z-50 bg-sidebar flex flex-col rounded-r-none">
            <div className="w-full max-h-full flex flex-col flex-1 overflow-hidden">
              <GlobalSearch onClose={() => setSearchOpen(false)} isDashboard={true} />
            </div>
          </div>
        )}

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 flex items-center justify-center text-xs font-bold text-sidebar-primary">
              {(user?.full_name || user?.email || "?")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.full_name || user?.email}</p>
              <p className="text-xs text-sidebar-foreground/50 truncate">{user?.role}</p>
            </div>
            <button onClick={() => base44.auth.logout()} className="text-sidebar-foreground/50 hover:text-sidebar-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile nav sheet */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-40 bg-card/80 backdrop-blur-lg border-b border-border/50 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {brand?.logo_url
              ? <img src={brand.logo_url} alt="logo" className="h-6 w-6 object-contain rounded" />
              : <Coffee className="h-5 w-5 text-primary" />
            }
            <span className="font-bold text-sm">{brand?.business_name || company?.name || "OWCR Dashboard"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button className="text-muted-foreground p-1">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
                <div className="p-5 border-b border-sidebar-border">
                  <BrandMark small />
                </div>
                <nav className="flex-1 p-3 space-y-1">
                  <NavLinks isActive={isActive} onNavigate={() => setMobileOpen(false)} user={user} unreadChat={unreadChat} unreadForum={unreadForum} markChatSeen={markChatSeen} markForumSeen={markForumSeen} />
                </nav>
                <div className="p-3 border-t border-sidebar-border">
                  <button
                    onClick={() => base44.auth.logout()}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 w-full"
                  >
                    <LogOut className="h-4 w-4" /> Log Out
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <TrialBanner />
        <main className="flex-1 p-4 md:p-8 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}