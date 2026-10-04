import React, { ReactNode, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Gauge,
  History,
  KeyRound,
  Layers3,
  LogOut,
  Menu,
  PanelsTopLeft,
  ReceiptText,
  RotateCcw,
  Settings,
  ShieldCheck,
  Store,
  Users,
  X,
} from "lucide-react";
import { Link, matchPath, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { NotificationCenter } from "@/features/notifications/NotificationCenter";
import { StoreLogo } from "@/shared/components/brand/StoreLogo";
import { NotFoundPage } from "@/pages/public/NotFoundPage";
import { fetchWarehouseDocument, type WarehouseDocumentType } from "@/shared/api/warehouse";
import { AppButton } from "@/shared/ui/AppButton";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import { useMobileSidebarDrag } from "@/shared/hooks/useMobileSidebarDrag";
import "./AdminLayout.css";

type NavigationLink = {
  type?: "link";
  to: string;
  label: string;
  permission: string | null;
  icon: React.ReactElement;
  nested?: boolean;
};

type NavigationSection = {
  type: "section";
  label: string;
  permission: string | null;
};

const menu: Array<NavigationLink | NavigationSection> = [
  { to: "/admin", label: "Дашборд", permission: "pages.dashboard.view", icon: <Gauge /> },
  { to: "/admin/products", label: "Товары", permission: "pages.products.view", icon: <Boxes /> },
  {
    to: "/admin/products/price-analytics",
    label: "Аналитика цен",
    permission: "pages.products.view",
    icon: <CircleDollarSign />,
    nested: true,
  },
  {
    to: "/admin/categories",
    label: "Категории",
    permission: "pages.categories.view",
    icon: <Layers3 />,
  },
  {
    to: "/admin/users",
    label: "Пользователи",
    permission: "pages.users.view",
    icon: <Users />,
  },
  {
    to: "/admin/work-time",
    label: "Рабочее время",
    permission: "pages.worktime.view",
    icon: <Clock3 />,
  },
  { to: "/admin/orders", label: "Заказы", permission: "pages.orders.view", icon: <ReceiptText /> },
  {
    to: "/admin/orders/new",
    label: "Создать заказ",
    permission: "orders.update",
    icon: <ClipboardList />,
    nested: true,
  },
  {
    to: "/admin/regular-buyers",
    label: "Постоянные покупатели",
    permission: "pages.regular-buyers.view",
    icon: <Users />,
  },
  {
    to: "/admin/analytics",
    label: "Аналитика продаж",
    permission: "pages.analytics.view",
    icon: <BarChart3 />,
  },
  {
    to: "/admin/audit",
    label: "Журнал действий",
    permission: "pages.audit.view",
    icon: <History />,
  },
  { to: "/admin/roles", label: "Роли", permission: "pages.roles.view", icon: <ShieldCheck /> },
  { to: "/admin/permissions", label: "Права", permission: "roles.read", icon: <KeyRound /> },
  {
    to: "/admin/settings",
    label: "Настройки",
    permission: null,
    icon: <Settings />,
  },
  { type: "section", label: "Склад", permission: null },
  {
    to: "/admin/warehouse",
    label: "Остатки",
    permission: "warehouse.read",
    icon: <Boxes />,
  },
  {
    to: "/admin/warehouse/documents",
    label: "Все документы",
    permission: "warehouse.read",
    icon: <ClipboardList />,
    nested: true,
  },
  {
    to: "/admin/warehouse/stock-shortages",
    label: "Отпуски с расхождением",
    permission: "warehouse.read",
    icon: <AlertTriangle />,
    nested: true,
  },
  {
    to: "/admin/warehouse/receipts",
    label: "Приходы",
    permission: "warehouse.read",
    icon: <ClipboardList />,
    nested: true,
  },
  {
    to: "/admin/warehouse/purchase-orders",
    label: "Заказы поставщикам",
    permission: "warehouse.read",
    icon: <ClipboardList />,
    nested: true,
  },
  {
    to: "/admin/warehouse/counterparties",
    label: "Контрагенты",
    permission: "warehouse.read",
    icon: <Users />,
    nested: true,
  },
  {
    to: "/admin/warehouse/price-settings",
    label: "Установка цен",
    permission: "warehouse.read",
    icon: <CircleDollarSign />,
    nested: true,
  },
  {
    to: "/admin/warehouse/opening-balances",
    label: "Начальные остатки",
    permission: "warehouse.read",
    icon: <ClipboardList />,
    nested: true,
  },
  {
    to: "/admin/warehouse/returns",
    label: "Возвраты",
    permission: "warehouse.read",
    icon: <RotateCcw />,
    nested: true,
  },
  {
    to: "/admin/warehouse/inventory",
    label: "Инвентаризация",
    permission: "warehouse.read",
    icon: <ClipboardList />,
    nested: true,
  },
  { type: "section", label: "Инструменты", permission: "pages.uiKit.view" },
  {
    to: "/admin/ui-kit",
    label: "UI-kit",
    permission: "pages.uiKit.view",
    icon: <PanelsTopLeft />,
  },
] as const;

const WAREHOUSE_DOCUMENT_NAVIGATION: Partial<Record<WarehouseDocumentType, string>> = {
  RECEIPT: "/admin/warehouse/receipts",
  PURCHASE_ORDER: "/admin/warehouse/purchase-orders",
  PRICE_SETTING: "/admin/warehouse/price-settings",
  OPENING_BALANCE: "/admin/warehouse/opening-balances",
  CUSTOMER_RETURN: "/admin/warehouse/returns",
  INVENTORY: "/admin/warehouse/inventory",
};

export function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, authLoading, logout } = useCommerce();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarDrag = useMobileSidebarDrag({
    open: mobileNavOpen,
    setOpen: setMobileNavOpen,
    panelRef: sidebarRef,
  });

  const permissions = new Set(user?.permissions ?? []);
  const visibleMenu = menu.filter(
    (item) =>
      !item.permission ||
      permissions.has(item.permission) ||
      (item.permission === "pages.worktime.view" && permissions.has("worktime.manage")),
  );
  const warehouseDocumentMatch = matchPath(
    { path: "/admin/warehouse/documents/:documentId", end: true },
    location.pathname,
  );
  const warehouseDocumentId = warehouseDocumentMatch?.params.documentId;
  const warehouseDocument = useQuery({
    queryKey: ["warehouse-document", warehouseDocumentId],
    queryFn: () => fetchWarehouseDocument(warehouseDocumentId!),
    enabled: Boolean(warehouseDocumentId && user),
  });
  const activeWarehouseDocumentNavigation = warehouseDocument.data
    ? (WAREHOUSE_DOCUMENT_NAVIGATION[warehouseDocument.data.type] ?? "/admin/warehouse/documents")
    : null;

  function navigationClassName(item: NavigationLink, routeIsActive: boolean) {
    const active = warehouseDocumentId
      ? activeWarehouseDocumentNavigation === item.to
      : routeIsActive;
    return [item.nested ? "admin-nav__subitem" : "", active ? "active" : ""]
      .filter(Boolean)
      .join(" ");
  }

  useEffect(() => {
    if (!mobileNavOpen) return;

    const scrollY = window.scrollY;
    const previousStyles = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousStyles.overflow;
      document.body.style.position = previousStyles.position;
      document.body.style.top = previousStyles.top;
      document.body.style.width = previousStyles.width;
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileNavOpen]);

  if (authLoading) {
    return (
      <div className="admin-page">
        <AppSkeleton />
      </div>
    );
  }
  if (!user || !user.adminAccess) return <NotFoundPage />;

  return (
    <div className="admin-shell">
      <aside
        ref={sidebarRef}
        className={`admin-sidebar ${mobileNavOpen ? "is-open" : ""} ${
          sidebarDrag.isDragging ? "is-dragging" : ""
        }`}
        style={sidebarDrag.sidebarStyle}
        onTouchStart={sidebarDrag.handlePanelTouchStart}
      >
        <Link className="brand-block" to="/admin">
          <StoreLogo />
        </Link>

        <AppButton
          className="admin-sidebar__close icon-button"
          type="button"
          variant="ghost"
          aria-label="Закрыть меню"
          onClick={() => setMobileNavOpen(false)}
        >
          <X size={20} />
        </AppButton>

        <nav className="admin-nav" aria-label="Разделы управления магазином">
          {visibleMenu.map((item) =>
            item.type === "section" ? (
              <p className="admin-nav__section" key={item.label}>
                {item.label}
              </p>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={
                  item.to === "/admin" ||
                  item.to === "/admin/products" ||
                  item.to === "/admin/orders" ||
                  item.to === "/admin/warehouse"
                }
                className={({ isActive }) => navigationClassName(item, isActive)}
                onClick={() => setMobileNavOpen(false)}
              >
                {React.cloneElement(item.icon, { size: 18, strokeWidth: 1.8 })}
                <span>{item.label}</span>
              </NavLink>
            ),
          )}
        </nav>

        <div className="admin-sidebar__footer">
          <AppButton
            className="sidebar-utility"
            type="button"
            variant="ghost"
            onClick={() => {
              void logout().then(() => navigate("/admin/login"));
            }}
          >
            <LogOut size={20} />
            <span>Выйти</span>
          </AppButton>
          <div className="admin-profile">
            <div className="avatar" aria-hidden="true">
              {user.name?.trim().charAt(0).toUpperCase() || "А"}
            </div>
            <div>
              <b>{user?.name ?? "Админ"}</b>
              <span>GastroFlow</span>
            </div>
          </div>
        </div>
      </aside>
      {sidebarDrag.shouldRender && (
        <button
          className={`admin-sidebar-backdrop ${sidebarDrag.isDragging ? "is-dragging" : ""}`}
          type="button"
          aria-label="Закрыть меню"
          style={sidebarDrag.backdropStyle}
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar__mobile">
            <AppButton
              className="admin-mobile-menu-button icon-button"
              type="button"
              variant="secondary"
              aria-label="Открыть меню"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={21} />
            </AppButton>
            <Link className="admin-topbar__brand" to="/admin">
              <StoreLogo compact />
            </Link>
          </div>
          <div className="topbar-actions">
            <NotificationCenter userId={user?.id} />
            <AppButton asChild variant="secondary" className="icon-button admin-store-link">
              <Link to="/" aria-label="Магазин">
                <Store size={20} />
              </Link>
            </AppButton>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
