import { Outlet, Link, useLocation } from "react-router-dom";
import {
  Settings,
  LogOut,
  BookOpen,
  MessageSquare,
  MessageCircle,
  Search,
  ClipboardList,
  ListChecks,
  LayoutDashboard,
  Users,
  Home,
  Menu,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useState } from "react";
import GlobalSearch from "@/components/shared/GlobalSearch";
import { useBrandSettings } from "@/hooks/useBrandSettings";
import { useQuery } from "@tanstack/react-query";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";
import NotificationsBell from "@/components/shared/NotificationsBell";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

function NavRow({ to, icon: Icon, label, active, badge = 0, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted"
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function EmployeeLayout() {
  const location = useLocation();
  const { user } = useAuth();
  const { data: brand } = useBrandSettings();
  const { data: company } = useQuery({
    queryKey: ["company-info"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyInfo", {});
      return res.data.success ? res.data.company : null;
    },
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { unreadChat, unreadForum, markChatSeen, markForumSeen } = useUnreadCounts();

  const isActive = (path) =>
    path === "/home" ? location.pathname === "/home" : location.pathname.startsWith(path);
  const hasDashboardAccess =
    user?.role === "admin" || user?.role === "manager" || user?.role === "supervisor";

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-lg border-b border-border/50">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/home" className="flex items-center gap-2.5">
            {brand?.logo_url ? (
              <img src={brand.logo_url} alt="Logo" className="h-9 w-9 rounded-xl object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">
                  {(brand?.business_name || company?.name || "O")[0].toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <h1 className="font-bold text-sm leading-tight">
                {brand?.business_name || company?.name || "OWCR"}
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {user?.full_name || user?.email}
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </button>
            <NotificationsBell />
            <button
              onClick={() => setMenuOpen(true)}
              className="relative h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Menu"
            >
              <Menu className="h-5 w-5" />
              {unreadChat + unreadForum > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6">
        <Outlet />
      </main>

      {/* Hamburger nav */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="w-72 p-0 flex flex-col">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
          <div className="px-4 h-16 flex items-center border-b border-border/50">
            <p className="font-bold text-sm">{brand?.business_name || company?.name || "Menu"}</p>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            <NavRow to="/home" icon={Home} label="Dashboard" active={isActive("/home")} onClick={closeMenu} />
            <NavRow to="/checklists" icon={ClipboardList} label="Checklists" active={isActive("/checklists")} onClick={closeMenu} />
            <NavRow to="/my-todos" icon={ListChecks} label="My Tasks" active={isActive("/my-todos")} onClick={closeMenu} />
            <NavRow to="/knowledge-base" icon={BookOpen} label="Knowledge" active={isActive("/knowledge-base")} onClick={closeMenu} />
            <NavRow
              to="/forum"
              icon={MessageSquare}
              label="Message Board"
              active={isActive("/forum")}
              badge={unreadForum}
              onClick={() => {
                markForumSeen();
                closeMenu();
              }}
            />
            <NavRow
              to="/chat"
              icon={MessageCircle}
              label="Chat"
              active={isActive("/chat")}
              badge={unreadChat}
              onClick={() => {
                markChatSeen();
                closeMenu();
              }}
            />
            <NavRow to="/directory" icon={Users} label="Team" active={isActive("/directory")} onClick={closeMenu} />
            <button
              onClick={() => {
                setSearchOpen(true);
                closeMenu();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground/80 hover:bg-muted transition-colors"
            >
              <Search className="h-5 w-5 shrink-0" />
              <span className="flex-1 text-left">Search</span>
            </button>
            <NavRow to="/settings" icon={Settings} label="Settings" active={isActive("/settings")} onClick={closeMenu} />

            {hasDashboardAccess && (
              <div className="pt-2 mt-2 border-t border-border/50">
                <NavRow
                  to="/dashboard"
                  icon={LayoutDashboard}
                  label="Management Dashboard"
                  active={false}
                  onClick={closeMenu}
                />
              </div>
            )}
          </nav>
          <div className="p-3 border-t border-border/50">
            <button
              onClick={() => base44.auth.logout()}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground/80 hover:bg-muted transition-colors"
            >
              <LogOut className="h-5 w-5" /> Log Out
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Search Overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setSearchOpen(false)}>
          <div className="w-full bg-card rounded-t-2xl max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-muted rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />
            <GlobalSearch onClose={() => setSearchOpen(false)} isDashboard={false} />
          </div>
        </div>
      )}
    </div>
  );
}
