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
import RouteErrorBoundary from "@/components/shared/RouteErrorBoundary";

import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

import RoleRouter from "@/pages/RoleRouter";
import EmployeeLayout from "@/components/layout/EmployeeLayout";
import EmployeeDashboard from "@/pages/EmployeeDashboard";
import EmployeeHome from "@/pages/EmployeeHome";
import ChecklistDetail from "@/pages/ChecklistDetail";
import NewChecklist from "@/pages/NewChecklist";
import EmployeeSettings from "@/pages/EmployeeSettings";
import EmployeeDirectory from "@/pages/EmployeeDirectory";
import MyTodosPage from "@/pages/MyTodosPage";
import MyCateringPage from "@/pages/MyCateringPage";

import DashboardLayout from "@/components/layout/DashboardLayout";
import OperationsHome from "@/pages/OperationsHome";
import ChecklistOverview from "@/pages/Dashboard";
import ChecklistReview from "@/pages/ChecklistReview";
import DashboardIssues from "@/pages/DashboardIssues";
import DashboardEmployees from "@/pages/DashboardEmployees";
import DashboardRoles from "@/pages/DashboardRoles";
import DashboardLocations from "@/pages/DashboardLocations";
import DashboardSettings from "@/pages/DashboardSettings.jsx";
import ChecklistEditor from "@/pages/ChecklistEditor";
import SpreadsheetImport from "@/pages/SpreadsheetImport";
import ChecklistSetup from "@/pages/ChecklistSetup";
import DepositReports from "@/pages/DepositReports";
import KnowledgeBase from "@/pages/KnowledgeBase";
import DashboardTodos from "@/pages/DashboardTodos";
import DashboardCatering from "@/pages/DashboardCatering";
import EmployeeKnowledgeBase from "@/pages/EmployeeKnowledgeBasePage";
import Forum from "@/pages/Forum";
import Chat from "@/pages/Chat";
import PrivateGroups from "@/pages/PrivateGroups";
import Equipment from "@/pages/Equipment";
import InventoryRoute from "@/components/inventory/InventoryRoute";
import InventoryLayout from "@/components/inventory/InventoryLayout";
import InventoryDashboard from "@/pages/inventory/Dashboard.jsx";
import InventoryCatalog from "@/pages/inventory/MasterCatalog";
import InventoryStock from "@/pages/inventory/LocationStock.jsx";
import InventoryCounts from "@/pages/inventory/InventoryCounts.jsx";
import InventoryOrders from "@/pages/inventory/VendorOrders.jsx";
import InventoryOnlineOrders from "@/pages/inventory/OnlineOrders";
import InventoryInStoreOrders from "@/pages/inventory/InStoreOrders";
import InventoryCommissary from "@/pages/inventory/Commissary.jsx";
import InventoryTransfers from "@/pages/inventory/Transfers";
import InventoryInvoices from "@/pages/inventory/Invoices";
import InventoryPools from "@/pages/inventory/Pools";
import InventoryVendors from "@/pages/inventory/Vendors";
import InventoryReports from "@/pages/inventory/Reports.jsx";
import InventoryRecipesPricing from "@/pages/inventory/RecipesPricing";
import InventorySettings from "@/pages/inventory/Settings";
import VendorOrderView from "@/pages/inventory/VendorOrderView";
import RoasteryLayout from "@/components/roastery/RoasteryLayout";
import RoasteryDashboard from "@/pages/roastery/Dashboard.jsx";
import RoasteryInventory from "@/pages/roastery/Inventory.jsx";
import RoasteryCoffeeLibrary from "@/pages/roastery/CoffeeLibrary.jsx";
import RoasteryWarehouses from "@/pages/roastery/Warehouses.jsx";
import RoasteryReleaseSchedule from "@/pages/roastery/ReleaseSchedule.jsx";
import RoasteryPricingCalculator from "@/pages/roastery/PricingCalculator.jsx";
import RoasteryInvoices from "@/pages/roastery/Invoices.jsx";
import RoasteryReports from "@/pages/roastery/Reports.jsx";
import RoasterySettings from "@/pages/roastery/Settings.jsx";
import FinancialLayout from "@/components/financial/FinancialLayout";
import FinancialDashboard from "@/pages/financial/Dashboard.jsx";
import FinancialScheduleBuilder from "@/pages/financial/ScheduleBuilder.jsx";
import FinancialMonthlyForecast from "@/pages/financial/MonthlyForecast.jsx";
import FinancialSalesInsights from "@/pages/financial/SalesInsights.jsx";
import FinancialLaborSettings from "@/pages/financial/LaborSettings.jsx";
import FinancialSettings from "@/pages/financial/Settings.jsx";
import FinancialSquareCallback from "@/pages/financial/SquareCallback.jsx";

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
      <Route path="/vendor/order" element={<VendorOrderView />} />

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
          <Route path="/home" element={<EmployeeDashboard />} />
          <Route path="/checklists" element={<EmployeeHome />} />
          <Route path="/my-todos" element={<MyTodosPage />} />
          <Route path="/my-events" element={<MyCateringPage />} />
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
          <Route path="/dashboard" element={<OperationsHome />} />
          <Route path="/dashboard/checklists" element={<Navigate to="/dashboard/checklists/overview" replace />} />
          <Route path="/dashboard/checklists/overview" element={<ChecklistOverview />} />
          <Route path="/dashboard/review/:instanceId" element={<ChecklistReview />} />
          <Route path="/dashboard/issues" element={<DashboardIssues />} />
          <Route path="/dashboard/employees" element={<DashboardEmployees />} />
          <Route path="/dashboard/roles" element={<DashboardRoles />} />
          <Route path="/dashboard/locations" element={<DashboardLocations />} />
          <Route path="/dashboard/settings" element={<DashboardSettings />} />
          <Route path="/dashboard/checklist/:checklistId/edit" element={<ChecklistEditor />} />
          <Route path="/dashboard/import" element={<SpreadsheetImport />} />
          <Route path="/dashboard/checklists/setup" element={<ChecklistSetup />} />
          <Route path="/dashboard/deposits" element={<DepositReports />} />
          <Route path="/dashboard/todos" element={<DashboardTodos />} />
          <Route path="/dashboard/catering" element={<DashboardCatering />} />
          <Route path="/dashboard/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/dashboard/forum" element={<Forum />} />
          <Route path="/dashboard/chat" element={<Chat />} />
          <Route path="/dashboard/private-groups" element={<PrivateGroups />} />
          <Route path="/dashboard/equipment" element={<Equipment />} />
          <Route path="/dashboard/roastery" element={<RoasteryLayout />}>
            <Route index element={<RoasteryDashboard />} />
            <Route path="inventory" element={<RoasteryInventory />} />
            <Route path="coffee-library" element={<RoasteryCoffeeLibrary />} />
            <Route path="warehouses" element={<RoasteryWarehouses />} />
            <Route path="release-schedule" element={<RoasteryReleaseSchedule />} />
            <Route path="pricing" element={<RoasteryPricingCalculator />} />
            <Route path="invoices" element={<RoasteryInvoices />} />
            <Route path="reports" element={<RoasteryReports />} />
            <Route path="settings" element={<RoasterySettings />} />
          </Route>
          <Route path="/dashboard/financial" element={<FinancialLayout />}>
            <Route index element={<FinancialDashboard />} />
            <Route path="schedule" element={<FinancialScheduleBuilder />} />
            <Route path="forecast" element={<FinancialMonthlyForecast />} />
            <Route path="sales-insights" element={<FinancialSalesInsights />} />
            <Route path="labor-settings" element={<FinancialLaborSettings />} />
            <Route path="settings" element={<FinancialSettings />} />
            <Route path="square-callback" element={<FinancialSquareCallback />} />
          </Route>
          <Route element={<InventoryRoute />}>
            <Route path="/dashboard/inventory" element={<InventoryLayout />}>
              <Route index element={<InventoryDashboard />} />
              <Route path="catalog" element={<InventoryCatalog />} />
              <Route path="stock" element={<InventoryStock />} />
              <Route path="counts" element={<InventoryCounts />} />
              <Route path="orders" element={<RouteErrorBoundary><InventoryOrders /></RouteErrorBoundary>} />
              <Route path="online-orders" element={<InventoryOnlineOrders />} />
              <Route path="instore-orders" element={<InventoryInStoreOrders />} />
              <Route path="commissary" element={<InventoryCommissary />} />
              <Route path="transfers" element={<InventoryTransfers />} />
              <Route path="invoices" element={<InventoryInvoices />} />
              <Route path="pools" element={<InventoryPools />} />
              <Route path="vendors" element={<InventoryVendors />} />
              <Route path="reports" element={<InventoryReports />} />
              <Route path="recipes-pricing" element={<InventoryRecipesPricing />} />
              <Route path="settings" element={<InventorySettings />} />
            </Route>
          </Route>
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
