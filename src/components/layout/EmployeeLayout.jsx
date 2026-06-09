import { Outlet, Link, useLocation } from "react-router-dom";
import { Settings, LogOut, BookOpen, MessageSquare, MessageCircle, Search, ClipboardList, LayoutDashboard, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useState } from "react";
import GlobalSearch from "@/components/shared/GlobalSearch";
import { useBrandSettings } from "@/hooks/useBrandSettings";
import { useQuery } from "@tanstack/react-query";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";

export default function EmployeeLayout() {
  const location = useLocation();
  const { user } = useAuth();
  const { data: brand } = useBrandSettings();
  const { data: company } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCompanyInfo', {});
      return res.data.success ? res.data.company : null;
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const { unreadChat, unreadForum, markChatSeen, markForumSeen } = useUnreadCounts();

  const isActive = (path) => location.pathname === path;
  const isAdmin = user?.role === "admin";
  const hasDashboardAccess = user?.role === "admin" || user?.role === "manager" || user?.role === "supervisor";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-lg border-b border-border/50">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
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
              <h1 className="font-bold text-sm leading-tight">{brand?.business_name || company?.name || "OWCR"}</h1>
              <p className="text-[11px] text-muted-foreground leading-tight">{user?.full_name || user?.email}</p>
            </div>
          </div>
          {hasDashboardAccess && (
            <Link
              to="/dashboard"
              className="h-9 px-3 rounded-lg flex items-center gap-2 text-primary hover:bg-muted transition-colors text-sm font-medium"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
          )}
          <button
            onClick={() => base44.auth.logout()}
            className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6">
        <Outlet />
      </main>

      {/* Search Overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setSearchOpen(false)}>
          <div className="w-full bg-card rounded-t-2xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-muted rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />
            <GlobalSearch onClose={() => setSearchOpen(false)} isDashboard={false} />
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <nav className="sticky bottom-0 z-40 bg-card/80 backdrop-blur-lg border-t border-border/50 safe-area-bottom">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-around">
          <Link to="/home" className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${location.pathname.startsWith("/home") ? "text-primary" : "text-muted-foreground"}`}>
            <ClipboardList className="h-5 w-5" />
            <span className="text-[10px] font-medium">Checklists</span>
          </Link>
          <Link to="/knowledge-base" className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${location.pathname.startsWith("/knowledge-base") ? "text-primary" : "text-muted-foreground"}`}>
            <BookOpen className="h-5 w-5" />
            <span className="text-[10px] font-medium">Knowledge</span>
          </Link>
          <button onClick={() => setSearchOpen(true)} className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors text-muted-foreground hover:text-primary">
            <Search className="h-5 w-5" />
            <span className="text-[10px] font-medium">Search</span>
          </button>
          <Link to="/forum" onClick={markForumSeen} className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${location.pathname.startsWith("/forum") ? "text-primary" : "text-muted-foreground"}`}>
            <div className="relative">
              <MessageSquare className="h-5 w-5" />
              {unreadForum > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none">
                  {unreadForum}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Board</span>
          </Link>
          <Link to="/chat" onClick={markChatSeen} className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${location.pathname.startsWith("/chat") ? "text-primary" : "text-muted-foreground"}`}>
            <div className="relative">
              <MessageCircle className="h-5 w-5" />
              {unreadChat > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none">
                  {unreadChat}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Chat</span>
          </Link>
          <Link to="/directory" className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${location.pathname.startsWith("/directory") ? "text-primary" : "text-muted-foreground"}`}>
            <Users className="h-5 w-5" />
            <span className="text-[10px] font-medium">Team</span>
          </Link>
          <Link to="/settings" className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${isActive("/settings") ? "text-primary" : "text-muted-foreground"}`}>
            <Settings className="h-5 w-5" />
            <span className="text-[10px] font-medium">Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}