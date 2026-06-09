import { useState } from "react";
import { Outlet, Link, useLocation, Navigate } from "react-router-dom";
import { LayoutDashboard, Building2, Shield, Settings, LogOut, HardDriveDownload } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";

export default function SuperAdminLayout() {
  const location = useLocation();
  const { user } = useAuth();

  // Redirect non-super-admins
  if (user?.role !== 'super_admin') {
    return <Navigate to="/" replace />;
  }

  const navItems = [
    { path: "/super-admin", label: "Dashboard", icon: LayoutDashboard },
    { path: "/super-admin/companies", label: "Companies", icon: Building2 },
    { path: "/super-admin/users", label: "Super Users", icon: Shield },
    { path: "/super-admin/settings", label: "Settings", icon: Settings },
    { path: "/super-admin/migration", label: "Data Migration", icon: HardDriveDownload },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border min-h-screen p-4">
        <div className="mb-8">
          <h2 className="text-lg font-bold text-sidebar-foreground">Super Admin</h2>
          <p className="text-xs text-sidebar-foreground/70">Platform Management</p>
        </div>
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.path)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-4 left-4 right-4 space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={() => base44.auth.logout()}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Log Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}