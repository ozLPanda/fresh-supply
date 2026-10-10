import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AdminLayout } from "@/layouts/AdminLayout";
import { CatalogPage } from "@/pages/public/CatalogPage";
import { CategoriesCatalogPage } from "@/pages/public/CategoriesCatalogPage";
import { CategoryPage } from "@/pages/public/CategoryPage";
import { HomePage } from "@/pages/public/HomePage";
import { ProductPage } from "@/pages/public/ProductPage";
import { NotFoundPage } from "@/pages/public/NotFoundPage";
import { CategoriesPage } from "@/pages/admin/CategoriesPage";
import { CategoryFormPage } from "@/pages/admin/CategoryFormPage";
import { DashboardPage } from "@/pages/admin/DashboardPage";
import { ExternalSoftwarePage } from "@/pages/admin/ExternalSoftwarePage";
import { LoginPage } from "@/pages/admin/LoginPage";
import { PermissionsPage } from "@/pages/admin/PermissionsPage";
import { PriceImportPage } from "@/pages/admin/PriceImportPage";
import { ProductPriceAnalyticsPage } from "@/pages/admin/ProductPriceAnalyticsPage";
import { ProductViewAnalyticsPage } from "@/pages/admin/ProductViewAnalyticsPage";
import { ImportCreatedProductsPage } from "@/pages/admin/ImportCreatedProductsPage";
import { WarehouseBalancesPage } from "@/pages/admin/warehouse/WarehouseBalancesPage";
import { WarehouseDocumentPage } from "@/pages/admin/warehouse/WarehouseDocumentPage";
import { WarehouseDocumentsPage } from "@/pages/admin/warehouse/WarehouseDocumentsPage";
import { WarehouseReservationOrdersPage } from "@/pages/admin/warehouse/WarehouseReservationOrdersPage";
import { WarehouseProductMovementsPage } from "@/pages/admin/warehouse/WarehouseProductMovementsPage";
import { WarehouseStockShortagesPage } from "@/pages/admin/warehouse/WarehouseStockShortagesPage";
import { WarehouseCounterpartiesPage } from "@/pages/admin/warehouse/WarehouseCounterpartiesPage";
import { ProductFormPage } from "@/pages/admin/ProductFormPage";
import { ProductsPage } from "@/pages/admin/ProductsPage";
import { RolesPage } from "@/pages/admin/RolesPage";
import { SettingsPage } from "@/pages/admin/SettingsPage";
import { ProductAvailabilityAnalysisPage } from "@/pages/admin/ProductAvailabilityAnalysisPage";
import { UsersPage } from "@/pages/admin/UsersPage";
import { UserDetailPage } from "@/pages/admin/UserDetailPage";
import { AdminOrdersPage } from "@/pages/admin/OrdersPage";
import { RegularBuyersPage } from "@/pages/admin/RegularBuyersPage";
import { AdminOrderDetailPage } from "@/pages/admin/OrderDetailPage";
import { AuditLogPage } from "@/pages/admin/AuditLogPage";
import { WhatsAppInboxPage } from "@/pages/admin/WhatsAppInboxPage";
import { MksCatalogPage } from "@/pages/admin/MksCatalogPage";
import { SupplierProductsPage } from "@/pages/admin/SupplierProductsPage";
import { SupplierProductPage } from "@/pages/admin/SupplierProductPage";
import {
  BarcodeOrderCreatePage,
  ProductSelectionOrderCreatePage,
} from "@/pages/admin/BarcodeOrderCreatePage";
import { ReviewsPage } from "@/pages/admin/ReviewsPage";
import { BarcodeGeneratorPage } from "@/pages/admin/BarcodeGeneratorPage";
import { WorkTimePage } from "@/pages/admin/WorkTimePage";
import { SalesAnalyticsPage } from "@/pages/admin/SalesAnalyticsPage";
import { ProcurementProjectPage, ProcurementProjectsPage } from "@/pages/admin/ProcurementPages";
import { CustomerAuthPage } from "@/pages/customer/CustomerAuthPage";
import { CartPage } from "@/pages/customer/CartPage";
import { CheckoutPage } from "@/pages/customer/CheckoutPage";
import { ProfilePage } from "@/pages/customer/ProfilePage";
import { OrdersPage } from "@/pages/customer/OrdersPage";
import { OrderDetailPage } from "@/pages/customer/OrderDetailPage";
import { CommerceProvider, useCommerce } from "@/features/commerce/CommerceProvider";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppToaster } from "@/shared/ui/AppToast";
import { SeoMeta } from "@/shared/seo/SeoMeta";
import { PwaExperience } from "@/features/pwa/PwaExperience";
import { PushNotificationPrompt } from "@/features/notifications/PushNotificationPrompt";
import "./styles.css";

const queryClient = new QueryClient();
const UiKitPage = React.lazy(() =>
  import("@/pages/admin/UiKitPage").then((module) => ({ default: module.UiKitPage })),
);

function ScrollToTop() {
  const { pathname, state } = useLocation();

  useEffect(() => {
    if ((state as { restoreScroll?: boolean } | null)?.restoreScroll) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, state]);

  return null;
}

function PrivateRouteSeo() {
  const { pathname } = useLocation();
  const privateRoute =
    pathname.startsWith("/admin") ||
    ["/login", "/register", "/profile", "/cart", "/checkout"].includes(pathname) ||
    pathname.startsWith("/orders");

  if (!privateRoute) return null;
  return (
    <SeoMeta
      title="GastroFlow"
      description="Паназиатские продукты, овощи, фрукты и бакалея. Каталог и заказ онлайн."
      canonicalPath={pathname}
      robots="noindex,nofollow"
    />
  );
}

function AdminPermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { user, authLoading } = useCommerce();

  if (authLoading) {
    return (
      <div className="admin-page">
        <AppSkeleton />
      </div>
    );
  }
  if (!user?.permissions.includes(permission)) return <Navigate to="/admin" replace />;

  return <>{children}</>;
}

function WarehouseBalancesRoute() {
  const navigate = useNavigate();

  return (
    <WarehouseBalancesPage
      onCreateDocument={(type, returnState) =>
        navigate(
          type === "OPENING_BALANCE"
            ? "/admin/warehouse/opening-balances/new"
            : "/admin/warehouse/receipts/new",
          { state: { returnTo: "/admin/warehouse", returnState } },
        )
      }
    />
  );
}

const Kotel3DPage = React.lazy(() => import("@/pages/public/kotel3d/Kotel3DPage"));

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CommerceProvider>
        <BrowserRouter>
          <ScrollToTop />
          <PrivateRouteSeo />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/main2" element={<HomePage heroVariant="alternative" />} />
            <Route
              path="/kotel3d"
              element={
                <React.Suspense fallback={<div role="status">Загрузка 3D-просмотра…</div>}>
                  <Kotel3DPage />
                </React.Suspense>
              }
            />
            <Route path="/categories" element={<CategoriesCatalogPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/catalog/:slug" element={<CategoryPage />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/login" element={<CustomerAuthPage mode="login" />} />
            <Route path="/register" element={<CustomerAuthPage mode="register" />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/admin/login" element={<LoginPage />} />
            <Route
              path="/admin"
              element={
                <AdminLayout>
                  <DashboardPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products"
              element={
                <AdminLayout>
                  <ProductsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/suppliers"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="pages.supplier-products.view">
                    <SupplierProductsPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/suppliers/:id"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="pages.supplier-products.view">
                    <SupplierProductPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/new"
              element={
                <AdminLayout>
                  <ProductFormPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/import-prices"
              element={
                <AdminLayout>
                  <PriceImportPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/price-statistics"
              element={<Navigate to="/admin/products/price-analytics?tab=changes" replace />}
            />
            <Route
              path="/admin/products/price-analytics"
              element={
                <AdminLayout>
                  <ProductPriceAnalyticsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/product-views"
              element={
                <AdminLayout>
                  <ProductViewAnalyticsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/import-created"
              element={
                <AdminLayout>
                  <ImportCreatedProductsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/barcodes"
              element={
                <AdminLayout>
                  <BarcodeGeneratorPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/products/:id"
              element={
                <AdminLayout>
                  <ProductFormPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/categories"
              element={
                <AdminLayout>
                  <CategoriesPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/categories/new"
              element={
                <AdminLayout>
                  <CategoryFormPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/categories/:id"
              element={
                <AdminLayout>
                  <CategoryFormPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/users"
              element={
                <AdminLayout>
                  <UsersPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/users/:id"
              element={
                <AdminLayout>
                  <UserDetailPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/regular-buyers"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="pages.regular-buyers.view">
                    <RegularBuyersPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/orders"
              element={
                <AdminLayout>
                  <AdminOrdersPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/work-time"
              element={
                <AdminLayout>
                  <WorkTimePage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/analytics"
              element={
                <AdminLayout>
                  <SalesAnalyticsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/audit"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="pages.audit.view">
                    <AuditLogPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/mks-catalog"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="pages.mks.view">
                    <MksCatalogPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/whatsapp"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="pages.whatsapp.view">
                    <WhatsAppInboxPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/orders/new"
              element={
                <AdminLayout>
                  <ProductSelectionOrderCreatePage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/orders/barcode"
              element={
                <AdminLayout>
                  <BarcodeOrderCreatePage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/orders/:id"
              element={
                <AdminLayout>
                  <AdminOrderDetailPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/procurement"
              element={
                <AdminLayout>
                  <ProcurementProjectsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/procurement/:projectId"
              element={
                <AdminLayout>
                  <ProcurementProjectPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/reviews"
              element={
                <AdminLayout>
                  <ReviewsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/roles"
              element={
                <AdminLayout>
                  <RolesPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/roles/:roleId"
              element={
                <AdminLayout>
                  <RolesPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/permissions"
              element={
                <AdminLayout>
                  <PermissionsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/ui-kit"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="pages.uiKit.view">
                    <React.Suspense
                      fallback={
                        <div className="admin-page">
                          <AppSkeleton />
                        </div>
                      }
                    >
                      <UiKitPage />
                    </React.Suspense>
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/external-software"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="integrations.1c.credentials.manage">
                    <ExternalSoftwarePage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/settings"
              element={
                <AdminLayout>
                  <SettingsPage />
                </AdminLayout>
              }
            />
            <Route
              path="/admin/settings/product-availability-analysis"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="products.update">
                    <ProductAvailabilityAnalysisPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseBalancesRoute />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/balances/:productId/reservations"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseReservationOrdersPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/balances/:productId/movements"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseProductMovementsPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/documents"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentsPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/counterparties"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseCounterpartiesPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/stock-shortages"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseStockShortagesPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/receipts"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentsPage initialType="RECEIPT" initialTab="RECEIPT" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/purchase-orders"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentsPage
                      initialType="PURCHASE_ORDER"
                      initialTab="PURCHASE_ORDER"
                    />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/purchase-orders/new"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.manage">
                    <WarehouseDocumentPage initialType="PURCHASE_ORDER" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/receipts/new"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentPage initialType="RECEIPT" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/price-settings"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentsPage
                      initialType="PRICE_SETTING"
                      initialTab="PRICE_SETTING"
                    />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/price-settings/new"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentPage initialType="PRICE_SETTING" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/opening-balances"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentsPage
                      initialType="OPENING_BALANCE"
                      initialTab="OPENING_BALANCE"
                    />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/opening-balances/new"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentPage initialType="OPENING_BALANCE" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/returns"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentsPage
                      initialType="CUSTOMER_RETURN"
                      initialTab="CUSTOMER_RETURN"
                    />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/returns/new"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentPage initialType="CUSTOMER_RETURN" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/inventory"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentsPage initialType="INVENTORY" initialTab="INVENTORY" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/inventory/new"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentPage initialType="INVENTORY" />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route
              path="/admin/warehouse/documents/:documentId"
              element={
                <AdminLayout>
                  <AdminPermissionGate permission="warehouse.read">
                    <WarehouseDocumentPage />
                  </AdminPermissionGate>
                </AdminLayout>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          {import.meta.env.VITE_DESKTOP_MODE !== "true" && <PwaExperience />}
          <PushNotificationPrompt showPrompt={import.meta.env.VITE_DESKTOP_MODE === "true"} />
          <AppToaster />
        </BrowserRouter>
      </CommerceProvider>
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
