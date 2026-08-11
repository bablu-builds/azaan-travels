import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

import { AuthProvider } from '@/contexts/AuthContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { ProtectedRoute, RoleRoute, PermissionRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';

import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import DashboardPage from '@/pages/DashboardPage';
import AddWorkPage from '@/pages/AddWorkPage';
import EditWorkPage from '@/pages/EditWorkPage';
import WorkListPage from '@/pages/WorkListPage';
import PendingWorkPage from '@/pages/PendingWorkPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';
import DeletedItemsPage from '@/pages/DeletedItemsPage';
import AepsWithdrawalPage from '@/pages/AepsWithdrawalPage';
import ElectricRechargePage from '@/pages/ElectricRechargePage';
import MoneyTransferPage from '@/pages/MoneyTransferPage';
import FlightBookingPage from '@/pages/FlightBookingPage';
import QuickWorkPage from '@/pages/QuickWorkPage';
import DuePaymentsPage from '@/pages/DuePaymentsPage';

const queryClient = new QueryClient();

function AuthenticatedApp() {
  const { canManageWork, canAccessFinancialServices, canAccessQuickWork, canViewDeletedItems, isOwner, isManager } = useAuth();

  return (
    <ProtectedRoute>
      <Layout>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/dashboard" component={DashboardPage} />

          <Route path="/work/new">
            <PermissionRoute allowed={canManageWork} message="You don't have permission to add work entries. Contact the owner.">
              <AddWorkPage />
            </PermissionRoute>
          </Route>

          <Route path="/work/:id/edit">
            <PermissionRoute allowed={canManageWork} message="You don't have permission to edit work entries. Contact the owner.">
              <EditWorkPage />
            </PermissionRoute>
          </Route>

          <Route path="/work" component={WorkListPage} />
          <Route path="/pending" component={PendingWorkPage} />
          <Route path="/due-payments" component={DuePaymentsPage} />

          <Route path="/quick-work">
            <PermissionRoute allowed={canAccessQuickWork} message="You don't have permission to access Quick Action Work. Contact the owner.">
              <QuickWorkPage />
            </PermissionRoute>
          </Route>

          <Route path="/reports">
            <RoleRoute allow={['owner', 'manager']}><ReportsPage /></RoleRoute>
          </Route>

          <Route path="/settings" component={SettingsPage} />

          <Route path="/deleted">
            <PermissionRoute allowed={canViewDeletedItems} message="You don't have permission to view deleted items. Contact the owner.">
              <DeletedItemsPage />
            </PermissionRoute>
          </Route>

          <Route path="/aeps">
            <PermissionRoute allowed={canAccessFinancialServices} message="You don't have permission to access AEPS Withdrawal. Contact the owner.">
              <AepsWithdrawalPage />
            </PermissionRoute>
          </Route>

          <Route path="/electric-recharge">
            <PermissionRoute allowed={canAccessFinancialServices} message="You don't have permission to access Electric Recharge. Contact the owner.">
              <ElectricRechargePage />
            </PermissionRoute>
          </Route>

          <Route path="/money-transfer">
            <PermissionRoute allowed={canAccessFinancialServices} message="You don't have permission to access Money Transfer. Contact the owner.">
              <MoneyTransferPage />
            </PermissionRoute>
          </Route>

          <Route path="/flight-booking">
            <PermissionRoute allowed={canAccessFinancialServices} message="You don't have permission to access Flight Booking. Contact the owner.">
              <FlightBookingPage />
            </PermissionRoute>
          </Route>

          <Route component={NotFound} />
        </Switch>
      </Layout>
    </ProtectedRoute>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="*">
        <AuthenticatedApp />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <SettingsProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
          </SettingsProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
