import { useAuth } from "@/lib/AuthContext";
import { Navigate } from "react-router-dom";

export default function RoleRouter() {
  const { user } = useAuth();

  if (!user) return null;

  // Super admin goes to super admin dashboard
  if (user.role === "super_admin") {
    return <Navigate to="/super-admin" replace />;
  }

  // If user is admin but redirected to company dashboard, check if they should be super_admin
  if (user.role === "admin" && !user.company_id) {
    // App owner without company should be super_admin
    return <Navigate to="/restore-super-admin" replace />;
  }

  // Company admin/manager goes to dashboard; supervisor goes to employee view
  if (user.role === "admin" || user.role === "manager") {
    return <Navigate to="/dashboard" replace />;
  }

  return <Navigate to="/home" replace />;
}