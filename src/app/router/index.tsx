import { BrowserRouter, Routes, Route } from "react-router-dom";

import DashboardLayout from "../../layouts/DashboardLayout";

import DashboardPage from "../../pages/DashboardPage";
import EmployeesPage from "../../pages/EmployeesPage";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <DashboardLayout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
        </Routes>
      </DashboardLayout>
    </BrowserRouter>
  );
}