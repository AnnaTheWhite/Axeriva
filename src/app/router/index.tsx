import { BrowserRouter, Routes, Route } from "react-router-dom";

import DashboardLayout from "../../layouts/DashboardLayout";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import { ROLES } from "../../types/auth";

import LandingPage from "../../pages/LandingPage";
import PricingPage from "../../pages/PricingPage";
import LoginPage from "../../pages/LoginPage";
import RegisterPage from "../../pages/RegisterPage";
import AcceptInvitePage from "../../pages/AcceptInvitePage";
import VerifyEmailPage from "../../pages/VerifyEmailPage";
import ForgotPasswordPage from "../../pages/ForgotPasswordPage";
import ResetPasswordPage from "../../pages/ResetPasswordPage";
import DashboardPage from "../../pages/DashboardPage";
import EmployeesPage from "../../pages/EmployeesPage";
import ProjectsPage from "../../pages/ProjectsPage";
import ProjectDetailsPage from "../../pages/ProjectDetailsPage";
import SchedulePage from "../../pages/SchedulePage";
import CustomersPage from "../../pages/CustomersPage";
import SubscriptionPage from "../../pages/SubscriptionPage";
import TimeTrackingPage from "../../pages/TimeTrackingPage";
import SettingsPage from "../../pages/SettingsPage";
import OwnerCommandCenterPage from "../../pages/OwnerCommandCenterPage";
import MySchedulePage from "../../pages/MySchedulePage";
import MyTimePage from "../../pages/MyTimePage";
import MyProjectsPage from "../../pages/MyProjectsPage";
import MyProjectDetailsPage from "../../pages/MyProjectDetailsPage";
import ProfilePage from "../../pages/ProfilePage";
import PlatformDashboardPage from "../../pages/admin/PlatformDashboardPage";
import AdminCompaniesPage from "../../pages/admin/AdminCompaniesPage";
import AdminUsersPage from "../../pages/admin/AdminUsersPage";
import UserDetailsPage from "../../pages/admin/UserDetailsPage";
import AdminBillingPage from "../../pages/admin/AdminBillingPage";
import AdminLogsPage from "../../pages/admin/AdminLogsPage";

// "/" shows the public landing page to visitors. Logged-in users land on
// the page that matches their role instead of being redirected away.
function HomeRoute() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated || !user) {
    return <LandingPage />;
  }

  const homePageByRole = {
    [ROLES.DEVELOPER]: <PlatformDashboardPage />,
    [ROLES.BUSINESS_OWNER]: <DashboardPage />,
    [ROLES.EMPLOYEE]: <MySchedulePage />,
  };

  return <DashboardLayout>{homePageByRole[user.role]}</DashboardLayout>;
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

        {/* BUSINESS_OWNER */}
        <Route
          path="/employees"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <EmployeesPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <ProjectsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <ProjectDetailsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <CustomersPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/schedule"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <SchedulePage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/time-tracking"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <TimeTrackingPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/subscription"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <SubscriptionPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/command-center"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER, ROLES.DEVELOPER]}>
              <DashboardLayout>
                <OwnerCommandCenterPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute roles={[ROLES.BUSINESS_OWNER]}>
              <DashboardLayout>
                <SettingsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* EMPLOYEE */}
        <Route
          path="/my-schedule"
          element={
            <ProtectedRoute roles={[ROLES.EMPLOYEE]}>
              <DashboardLayout>
                <MySchedulePage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-time"
          element={
            <ProtectedRoute roles={[ROLES.EMPLOYEE]}>
              <DashboardLayout>
                <MyTimePage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-projects"
          element={
            <ProtectedRoute roles={[ROLES.EMPLOYEE]}>
              <DashboardLayout>
                <MyProjectsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-projects/:id"
          element={
            <ProtectedRoute roles={[ROLES.EMPLOYEE]}>
              <DashboardLayout>
                <MyProjectDetailsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute roles={[ROLES.EMPLOYEE]}>
              <DashboardLayout>
                <ProfilePage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* DEVELOPER */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={[ROLES.DEVELOPER]}>
              <DashboardLayout>
                <PlatformDashboardPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/companies"
          element={
            <ProtectedRoute roles={[ROLES.DEVELOPER]}>
              <DashboardLayout>
                <AdminCompaniesPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={[ROLES.DEVELOPER]}>
              <DashboardLayout>
                <AdminUsersPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <ProtectedRoute roles={[ROLES.DEVELOPER]}>
              <DashboardLayout>
                <UserDetailsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/billing"
          element={
            <ProtectedRoute roles={[ROLES.DEVELOPER]}>
              <DashboardLayout>
                <AdminBillingPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/logs"
          element={
            <ProtectedRoute roles={[ROLES.DEVELOPER]}>
              <DashboardLayout>
                <AdminLogsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
