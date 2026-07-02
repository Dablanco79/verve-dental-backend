import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { ClinicProvider } from "./clinic/ClinicProvider.js";
import { AccountPage } from "./pages/AccountPage.js";
import { HomePage } from "./pages/HomePage.js";
import { AddProductPage } from "./pages/AddProductPage.js";
import { AdjustmentHistoryPage } from "./pages/AdjustmentHistoryPage.js";
import { InventoryAdjustPage } from "./pages/InventoryAdjustPage.js";
import { InventoryPage } from "./pages/InventoryPage.js";
import { InventoryReceivingPage } from "./pages/InventoryReceivingPage.js";
import { PilotSetupPage } from "./pages/PilotSetupPage.js";
import { ProductDetailPage } from "./pages/ProductDetailPage.js";
import { ProductManagementPage } from "./pages/ProductManagementPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { ManageUsersPage } from "./pages/ManageUsersPage.js";
import { MyShiftsPage } from "./pages/MyShiftsPage.js";
import { PurchaseOrdersPage } from "./pages/PurchaseOrdersPage.js";
import { RosterCalendarPage } from "./pages/RosterCalendarPage.js";
import { LaborForecastPage } from "./pages/LaborForecastPage.js";
import { MaterialsForecastPage } from "./pages/MaterialsForecastPage.js";
import { ClinicSettingsPage } from "./pages/ClinicSettingsPage.js";
import { ClinicsListPage } from "./pages/ClinicsListPage.js";
import { CreateClinicPage } from "./pages/CreateClinicPage.js";
import { SecurityPage } from "./pages/SecurityPage.js";
import { BillingLedgerPage } from "./pages/BillingLedgerPage.js";
import { CatalogueImportPage } from "./pages/CatalogueImportPage.js";
import { AnalyticsDashboardPage } from "./pages/AnalyticsDashboardPage.js";
import { AuditTrailPage } from "./pages/AuditTrailPage.js";
import { TimesheetsPage } from "./pages/TimesheetsPage.js";
import { LeavePage } from "./pages/LeavePage.js";
import { SuppliersPage } from "./pages/SuppliersPage.js";
import { SupplierDetailPage } from "./pages/SupplierDetailPage.js";
import { SupplierInvoiceReviewPage } from "./pages/SupplierInvoiceReviewPage.js";
import { SupplierIntelligencePage } from "./pages/SupplierIntelligencePage.js";

export function App() {
  return (
    <AuthProvider>
      <ClinicProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/pilot-setup" element={<PilotSetupPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/inventory/catalogue-import" element={<CatalogueImportPage />} />
              <Route path="/inventory/products" element={<ProductManagementPage />} />
              <Route path="/inventory/products/new" element={<AddProductPage />} />
              <Route path="/inventory/products/:productId" element={<ProductDetailPage />} />
              <Route path="/inventory/receiving" element={<InventoryReceivingPage />} />
              <Route path="/inventory/adjust" element={<InventoryAdjustPage />} />
              <Route path="/inventory/adjustments" element={<AdjustmentHistoryPage />} />
              <Route path="/users" element={<ManageUsersPage />} />
              <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
              <Route path="/roster" element={<RosterCalendarPage />} />
              <Route path="/my-shifts" element={<MyShiftsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/forecast/labor" element={<LaborForecastPage />} />
              <Route path="/forecast/materials" element={<MaterialsForecastPage />} />
              <Route path="/settings/clinic" element={<ClinicSettingsPage />} />
              <Route path="/settings/clinics" element={<ClinicsListPage />} />
              <Route path="/settings/clinics/new" element={<CreateClinicPage />} />
              <Route path="/settings/clinics/:clinicId/edit" element={<ClinicSettingsPage />} />
              <Route path="/settings/security" element={<SecurityPage />} />
              <Route path="/timesheets" element={<TimesheetsPage />} />
              <Route path="/leave" element={<LeavePage />} />
              <Route path="/billing" element={<BillingLedgerPage />} />
              <Route path="/analytics" element={<AnalyticsDashboardPage />} />
              <Route path="/analytics/audit" element={<AuditTrailPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/suppliers/:supplierId" element={<SupplierDetailPage />} />
              <Route path="/invoice-review/:invoiceId" element={<SupplierInvoiceReviewPage />} />
              <Route path="/supplier-intelligence" element={<SupplierIntelligencePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ClinicProvider>
    </AuthProvider>
  );
}
