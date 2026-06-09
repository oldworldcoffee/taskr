import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import ProtectedRoute from "@/components/ProtectedRoute";
import BrandThemeProvider from "@/components/shared/BrandThemeProvider";

import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

import RoleRouter from "@/pages/RoleRouter";
import EmployeeLayout from "@/components/layout/EmployeeLayout";
import EmployeeHome from "@/pages/EmployeeHome";
import ChecklistDetail from "@/pages/ChecklistDetail";
import NewChecklist from "@/pages/NewChecklist";
import EmployeeSettings from "@/pages/EmployeeSettings";
import EmployeeDirectory from "@/pages/EmployeeDirectory";

import DashboardLayout from "@/components/layout/DashboardLayout";
import Dashboard from "@/pages/Dashboard";
import ChecklistReview from "@/pages/ChecklistReview";
import DashboardIssues from "@/pages/DashboardIssues";
import DashboardEmployees from "@/pages/DashboardEmployees";
import DashboardSettings from "@/pages/DashboardSettings.jsx";
import ChecklistEditor from "@/pages/ChecklistEditor";
import SpreadsheetImport from "@/pages/SpreadsheetImport";
import ChecklistSetup from "@/pages/ChecklistSetup";
import DepositReports from "@/pages/DepositReports";
import KnowledgeBase from "@/pages/KnowledgeBase";
import EmployeeKnowledgeBase from "@/pages/EmployeeKnowledgeBase";
import Forum from "@/pages/Forum";
import Chat from "@/pages/Chat";
import PrivateGroups from "@/pages/PrivateGroups";
import Equipment from "@/pages/Equipment";

import SuperAdminLayout from "@/components/layout/SuperAdminLayout";
import SuperAdminOverview from "@/pages/super-admin/Overview";
import SuperAdminCompanies from "@/pages/super-admin/Companies";
import SuperAdminUsers from "@/pages/super-admin/SuperUsers";
import SuperAdminSettings from "@/pages/super-admin/Settings";
import DataMigration from "@/pages/super-admin/DataMigration";
import RestoreSuperAdmin from "@/pages/RestoreSuperAdmin";
import SelfEnroll from "@/pages/SelfEnroll";
import Setup from "@/pages/Setup";

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === "user_not_registered") {
      return <UserNotRegisteredError />;
    } else if (authError.type === "auth_required") {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Public Self-Enrollment Route */}
      <Route path="/enroll" element={<SelfEnroll />} />

      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        {/* Role Router */}
        <Route path="/" element={<RoleRouter />} />

        {/* Setup Route */}
        <Route path="/setup" element={<Setup />} />

        {/* Super Admin Routes */}
        <Route path="/restore-super-admin" element={<RestoreSuperAdmin />} />
      <Route element={<SuperAdminLayout />}>
        <Route path="/super-admin" element={<SuperAdminOverview />} />
        <Route path="/super-admin/companies" element={<SuperAdminCompanies />} />
        <Route path="/super-admin/users" element={<SuperAdminUsers />} />
        <Route path="/super-admin/settings" element={<SuperAdminSettings />} />
        <Route path="/super-admin/migration" element={<DataMigration />} />
      </Route>

        {/* Employee Routes */}
        <Route element={<EmployeeLayout />}>
          <Route path="/home" element={<EmployeeHome />} />
          <Route path="/checklist/:instanceId" element={<ChecklistDetail />} />
          <Route path="/checklist/new/:checklistId" element={<NewChecklist />} />
          <Route path="/settings" element={<EmployeeSettings />} />
          <Route path="/directory" element={<EmployeeDirectory />} />
          <Route path="/knowledge-base" element={<EmployeeKnowledgeBase />} />
          <Route path="/forum" element={<Forum />} />
          <Route path="/chat" element={<Chat />} />
        </Route>

        {/* Management Routes */}
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dashboard/review/:instanceId" element={<ChecklistReview />} />
          <Route path="/dashboard/issues" element={<DashboardIssues />} />
          <Route path="/dashboard/employees" element={<DashboardEmployees />} />
          <Route path="/dashboard/settings" element={<DashboardSettings />} />
          <Route path="/dashboard/checklist/:checklistId/edit" element={<ChecklistEditor />} />
          <Route path="/dashboard/import" element={<SpreadsheetImport />} />
          <Route path="/dashboard/checklists/setup" element={<ChecklistSetup />} />
          <Route path="/dashboard/deposits" element={<DepositReports />} />
          <Route path="/dashboard/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/dashboard/forum" element={<Forum />} />
          <Route path="/dashboard/chat" element={<Chat />} />
          <Route path="/dashboard/private-groups" element={<PrivateGroups />} />
          <Route path="/dashboard/equipment" element={<Equipment />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <BrandThemeProvider>
            <AuthenticatedApp />
          </BrandThemeProvider>
        </Router>
        <SonnerToaster />
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;