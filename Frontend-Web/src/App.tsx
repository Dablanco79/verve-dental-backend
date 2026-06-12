import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { AccountPage } from "./pages/AccountPage.js";
import { HomePage } from "./pages/HomePage.js";
import { AddProductPage } from "./pages/AddProductPage.js";
import { InventoryPage } from "./pages/InventoryPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { ManageUsersPage } from "./pages/ManageUsersPage.js";
import { MyShiftsPage } from "./pages/MyShiftsPage.js";
import { PurchaseOrdersPage } from "./pages/PurchaseOrdersPage.js";
import { RosterCalendarPage } from "./pages/RosterCalendarPage.js";

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/products/new" element={<AddProductPage />} />
            <Route path="/users" element={<ManageUsersPage />} />
            <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="/roster" element={<RosterCalendarPage />} />
            <Route path="/my-shifts" element={<MyShiftsPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
