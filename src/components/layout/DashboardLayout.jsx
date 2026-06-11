import { Outlet, Link, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Calculator,
  CalendarDays,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Coffee,
  DollarSign,
  FileText,
  Globe,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquare,
  Package,
  PackageCheck,
  Search,
  Settings,
  ShoppingCart,
  ShoppingBasket,
  Store,
  Truck,
  UserCircle,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useBrandSettings } from "@/hooks/useBrandSettings";
import { useQuery } from "@tanstack/react-query";
import GlobalSearch from "@/components/shared/GlobalSearch";
import TrialBanner from "@/components/shared/TrialBanner";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";

const dashboardItem = { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true };

const checklistItems = [
  { path: "/dashboard/checklists/overview", label: "Overview", icon: LayoutDashboard },
  { path: "/dashboard/issues", label: "Issues & Flags", icon: AlertTriangle },
  { path: "/dashboard/deposits", label: "Deposit Reports", icon: DollarSign },
  { path: "/dashboard/checklists/setup", label: "Setup", icon: Wrench },
];

const inventoryItems = [
  { path: "/dashboard/inventory", label: "Overview", icon: LayoutDashboard, exact: true },
  { path: "/dashboard/inventory/catalog", label: "Catalog", icon: Package },
  { path: "/dashboard/inventory/stock", label: "Stock", icon: MapPin },
  { path: "/dashboard/inventory/counts", label: "Counts", icon: ClipboardList },
  { path: "/dashboard/inventory/orders", label: "Orders", icon: ShoppingCart },
  { path: "/dashboard/inventory/online-orders", label: "Online Orders", icon: Globe },
  { path: "/dashboard/inventory/instore-orders", label: "In-Store Shopping", icon: ShoppingBasket },
  { path: "/dashboard/inventory/commissary", label: "Commissary", icon: Store },
  { path: "/dashboard/inventory/transfers", label: "Transfers", icon: ArrowLeftRight },
  { path: "/dashboard/inventory/invoices", label: "Invoices", icon: FileText },
  { path: "/dashboard/inventory/pools", label: "Pools", icon: Layers },
  { path: "/dashboard/inventory/vendors", label: "Vendors", icon: Truck },
  { path: "/dashboard/inventory/reports", label: "Reports", icon: BarChart3 },
  { path: "/dashboard/inventory/recipes-pricing", label: "Recipes & Pricing", icon: Calculator },
  { path: "/dashboard/inventory/settings", label: "Settings", icon: Settings },
];

const roasteryItems = [
  { path: "/dashboard/roastery", label: "Overview", icon: LayoutDashboard, exact: true },
  { path: "/dashboard/roastery/inventory", label: "Green Inventory", icon: Package },
  { path: "/dashboard/roastery/coffee-library", label: "Coffee Library", icon: BookOpen },
  { path: "/dashboard/roastery/warehouses", label: "Warehouses", icon: Warehouse },
  { path: "/dashboard/roastery/release-schedule", label: "Release Schedule", icon: CalendarDays },
  { path: "/dashboard/roastery/pricing", label: "Pricing Calculator", icon: Calculator },
  { path: "/dashboard/roastery/invoices", label: "Invoices", icon: FileText },
  { path: "/dashboard/roastery/reports", label: "Reports", icon: BarChart3 },
  { path: "/dashboard/roastery/settings", label: "Settings", icon: Settings },
];

const teamHubItems = [
  { path: "/dashboard/knowledge-base", label: "Knowledge Base", icon: BookOpen, roles: ["admin", "manager", "supervisor"] },
  { path: "/dashboard/forum", label: "Message Board", icon: MessageSquare, roles: ["admin", "manager"], badge: "forum" },
  { path: "/dashboard/chat", label: "Chat", icon: MessageCircle, roles: ["admin", "manager"], badge: "chat" },
  { path: "/dashboard/private-groups", label: "Private Groups", icon: Lock, roles: ["admin"] },
];

const primaryItems = [
  { path: "/dashboard/equipment", label: "Equipment", icon: Wrench, roles: ["admin", "manager"] },
  { path: "/dashboard/employees", label: "Employees", icon: Users, roles: ["admin", "manager"] },
  { path: "/dashboard/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];

const canSeeItem = (item, role) => !item.roles || item.roles.includes(role);

function NavLinkItem({
  item,
  isItemActive,
  onNavigate,
  unreadChat,
  unreadForum,
  markChatSeen,
  markForumSeen,
  compact = false,
}) {
  const Icon = item.icon;
  const badge = item.badge === "chat" ? unreadChat : item.badge === "forum" ? unreadForum : 0;
  const handleClick = () => {
    if (item.badge === "chat") markChatSeen?.();
    if (item.badge === "forum") markForumSeen?.();
    onNavigate?.();
  };

  return (
    <Link
      to={item.path}
      onClick={handleClick}
      className={`flex items-center gap-3 px-3 ${compact ? "py-2" : "py-2.5"} rounded-lg text-sm font-medium transition-colors ${
        isItemActive(item)
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      }`}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      <span className="flex-1">{item.label}</span>
      {badge > 0 && (
        <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </Link>
  );
}

function NavGroup({
  label,
  icon: Icon,
  items,
  active,
  defaultOpen = false,
  isItemActive,
  onNavigate,
  unreadChat,
  unreadForum,
  markChatSeen,
  markForumSeen,
  badge = 0,
}) {
  const [open, setOpen] = useState(defaultOpen || active);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{label}</span>
        {badge > 0 && !open && (
          <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="ml-4 pl-3 border-l border-sidebar-border/50 space-y-0.5">
          {items.map((item) => (
            <NavLinkItem
              key={item.path}
              item={item}
              isItemActive={isItemActive}
              onNavigate={onNavigate}
              unreadChat={unreadChat}
              unreadForum={unreadForum}
              markChatSeen={markChatSeen}
              markForumSeen={markForumSeen}
              compact
            />
          ))}
        </div>
      )}
    </>
  );
}

function NavLinks({ isActive, isExact, onNavigate, user, company, unreadChat, unreadForum, markChatSeen, markForumSeen }) {
  const role = user?.role;
  const { userHasFeature, hasRoasteryLocation } = useAuth();
  // Match the route guards: managers/admins by role, or any user with an
  // explicit grant; a roastery/hybrid location auto-enables roastery for staff.
  const inventoryEnabled = company?.enabled_features?.includes("inventory") && userHasFeature("inventory");
  const roasteryEnabled = userHasFeature("roastery") || (hasRoasteryLocation && ["admin", "manager", "super_admin"].includes(role));
  const visibleTeamHubItems = teamHubItems.filter((item) => canSeeItem(item, role));
  const visiblePrimaryItems = primaryItems.filter((item) => canSeeItem(item, role));
  const isItemActive = (item) => item.exact ? isExact(item.path) : isActive(item.path);
  const checklistsActive = isActive("/dashboard/checklists") || isActive("/dashboard/checklist") || isActive("/dashboard/issues") || isActive("/dashboard/deposits") || isActive("/dashboard/review");
  const inventoryActive = isActive("/dashboard/inventory");
  const roasteryActive = isActive("/dashboard/roastery");
  const teamHubActive = visibleTeamHubItems.some(isItemActive);
  const teamHubBadge = (unreadChat || 0) + (unreadForum || 0);

  return (
    <>
      <NavLinkItem
        item={dashboardItem}
        isItemActive={isItemActive}
        onNavigate={onNavigate}
        unreadChat={unreadChat}
        unreadForum={unreadForum}
        markChatSeen={markChatSeen}
        markForumSeen={markForumSeen}
      />

      <NavGroup
        label="Checklists"
        icon={ClipboardList}
        items={checklistItems}
        active={checklistsActive}
        defaultOpen
        isItemActive={isItemActive}
        onNavigate={onNavigate}
        unreadChat={unreadChat}
        unreadForum={unreadForum}
        markChatSeen={markChatSeen}
        markForumSeen={markForumSeen}
      />

      {inventoryEnabled && (
        <NavGroup
          label="Inventory"
          icon={PackageCheck}
          items={inventoryItems}
          active={inventoryActive}
          isItemActive={isItemActive}
          onNavigate={onNavigate}
          unreadChat={unreadChat}
          unreadForum={unreadForum}
          markChatSeen={markChatSeen}
          markForumSeen={markForumSeen}
        />
      )}

      {roasteryEnabled && (
        <NavGroup
          label="Roastery Management"
          icon={Coffee}
          items={roasteryItems}
          active={roasteryActive}
          isItemActive={isItemActive}
          onNavigate={onNavigate}
          unreadChat={unreadChat}
          unreadForum={unreadForum}
          markChatSeen={markChatSeen}
          markForumSeen={markForumSeen}
        />
      )}

      {visibleTeamHubItems.length > 0 && (
        <NavGroup
          label="Team Hub"
          icon={MessageCircle}
          items={visibleTeamHubItems}
          active={teamHubActive}
          isItemActive={isItemActive}
          onNavigate={onNavigate}
          unreadChat={unreadChat}
          unreadForum={unreadForum}
          markChatSeen={markChatSeen}
          markForumSeen={markForumSeen}
          badge={teamHubBadge}
        />
      )}

      {visiblePrimaryItems.map((item) => (
        <NavLinkItem
          key={item.path}
          item={item}
          isItemActive={isItemActive}
          onNavigate={onNavigate}
          unreadChat={unreadChat}
          unreadForum={unreadForum}
          markChatSeen={markChatSeen}
          markForumSeen={markForumSeen}
        />
      ))}

      <div className="pt-2 mt-2 border-t border-sidebar-border/50 space-y-1">
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
      </div>
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
      <div className={`${size} shrink-0 overflow-hidden rounded-lg ${logo ? "bg-transparent" : "bg-sidebar-primary flex items-center justify-center"}`}>
        {logo
          ? <img src={logo} alt="logo" className="h-full w-full object-cover" />
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
  const isExact = (path) => location.pathname === path;

  const { unreadChat, unreadForum, markChatSeen, markForumSeen } = useUnreadCounts();

  // ⌘K / Ctrl+K to open search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <NavLinks isActive={isActive} isExact={isExact} onNavigate={() => {}} user={user} company={company} unreadChat={unreadChat} unreadForum={unreadForum} markChatSeen={markChatSeen} markForumSeen={markForumSeen} />
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
              ? <img src={brand.logo_url} alt="logo" className="h-6 w-6 rounded-md object-cover" />
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
              <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border flex flex-col">
                <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
                <SheetDescription className="sr-only">Main dashboard navigation links</SheetDescription>
                <div className="p-5 border-b border-sidebar-border">
                  <BrandMark small />
                </div>
                <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                  <NavLinks isActive={isActive} isExact={isExact} onNavigate={() => setMobileOpen(false)} user={user} company={company} unreadChat={unreadChat} unreadForum={unreadForum} markChatSeen={markChatSeen} markForumSeen={markForumSeen} />
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
