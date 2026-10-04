import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  Home,
  LayoutGrid,
  LogIn,
  LogOut,
  Menu,
  Phone,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  X,
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { Category } from "@/shared/types/models";
import { isRenderableCategory } from "@/pages/public/store-utils";
import { AppButton } from "@/shared/ui/AppButton";
import { AppTooltip } from "@/shared/ui/AppFeedback";
import { StoreLogo } from "@/pages/public/StoreLogo";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { NotificationCenter } from "@/features/notifications/NotificationCenter";
import { formatMoney } from "@/pages/public/store-utils";
import { useMobileSidebarDrag } from "@/shared/hooks/useMobileSidebarDrag";
import "./StoreLayout.css";

const supportPhone = "+7 777 459 32 33";

function formatCartItemCount(count: number) {
  if (count < 1000) return String(count);

  const thousands = count / 1000;
  const rounded = thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10;

  return `${String(rounded).replace(/\.0$/, "")}k`;
}

export function StoreLayout({
  children,
  categories = [],
}: {
  children: ReactNode;
  categories?: Category[];
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { user, cart, logout } = useCommerce();
  const cartItemCountLabel = formatCartItemCount(cart.itemCount);
  const menuDrag = useMobileSidebarDrag({
    open: mobileMenuOpen,
    setOpen: setMobileMenuOpen,
    panelRef: menuRef,
  });
  const footerCategories = useMemo(
    () =>
      categories
        .filter((category) => category.active !== false && isRenderableCategory(category))
        .slice(0, 6),
    [categories],
  );

  useEffect(() => {
    if (!mobileMenuOpen) return;

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
      if (event.key === "Escape") setMobileMenuOpen(false);
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
  }, [mobileMenuOpen]);

  return (
    <div className="store-shell">
      <header className="store-header">
        <div className="store-header__inner">
          <AppButton
            type="button"
            variant="secondary"
            className="store-header__menu"
            aria-label="Открыть меню"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={24} />
          </AppButton>

          <Link className="store-header__brand" to="/">
            <StoreLogo />
          </Link>

          <nav className="store-header__nav" aria-label="Основная навигация">
            <NavLink to="/">Главная</NavLink>
            <NavLink to="/catalog">Каталог</NavLink>
          </nav>

          <div className="store-header__actions">
            <a className="store-header__phone" href={`tel:${supportPhone.replace(/\s/g, "")}`}>
              {supportPhone}
            </a>
            <AppButton asChild variant="ghost" className="store-header__cart">
              <Link to="/cart" aria-label={`Корзина: ${cart.itemCount} товаров`}>
                <ShoppingCart size={24} />
                <span>Корзина</span>
                {cart.itemCount > 0 && <b title={String(cart.itemCount)}>{cartItemCountLabel}</b>}
              </Link>
            </AppButton>
            {user ? (
              <>
                <NotificationCenter userId={user.id} />
                <AppButton asChild variant="secondary" className="store-header__login">
                  <Link to="/profile">
                    <UserRound size={18} />
                    <span>{formatMoney(user.balance)}</span>
                  </Link>
                </AppButton>
                <AppTooltip content="Выйти">
                  <AppButton
                    type="button"
                    variant="ghost"
                    className="store-header__logout store-header__icon-action"
                    aria-label="Выйти из аккаунта"
                    onClick={() => void logout()}
                  >
                    <LogOut size={20} />
                  </AppButton>
                </AppTooltip>
                {user.adminAccess && (
                  <AppTooltip content="Админка">
                    <AppButton
                      asChild
                      variant="ghost"
                      className="store-header__admin store-header__icon-action"
                    >
                      <Link to="/admin" aria-label="Админка">
                        <ShieldCheck size={20} />
                      </Link>
                    </AppButton>
                  </AppTooltip>
                )}
              </>
            ) : (
              <AppButton asChild variant="secondary" className="store-header__login">
                <Link to="/login">Вход</Link>
              </AppButton>
            )}
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="store-footer">
        <div className="store-footer__inner">
          <div className="store-footer__brand">
            <StoreLogo />
            <p>
              Профессиональное оборудование для отопления и инженерных систем. Подбираем решения для
              объектов любого масштаба.
            </p>
          </div>
          <div className="store-footer__group">
            <h3>Категории</h3>
            {footerCategories.map((category) => (
              <Link key={category.slug} to={`/catalog/${category.slug}`}>
                {category.nameRu}
              </Link>
            ))}
          </div>
          <div className="store-footer__group">
            <h3>Поддержка</h3>
            <a href={`tel:${supportPhone.replace(/\s/g, "")}`}>Связаться с нами</a>
            <a href="mailto:sales@active.kz">sales@active.kz</a>
            <span>Пн-Пт: 09:00 - 18:00</span>
          </div>
          <div className="store-footer__group">
            <h3>Контакты</h3>
            <span>Казахстан, г. Павлодар</span>
            <span>{supportPhone}</span>
            <span>© 2026 Фирма Актив</span>
          </div>
          <p className="store-footer__legal">
            Информация на сайте носит справочный характер и не является публичной офертой. Цены,
            наличие, характеристики и комплектация товаров подлежат уточнению и подтверждению
            продавцом на момент обработки заказа. Оформление заказа является заявкой покупателя и не
            означает автоматическое заключение договора купли-продажи: договор считается заключенным
            после подтверждения заказа продавцом и/или выставления счета с актуальной ценой. При
            выявлении технической ошибки, в том числе некорректной цены, продавец вправе отказать в
            подтверждении заказа либо предложить оформить заказ по актуальной цене; если оплата была
            произведена до подтверждения, она возвращается покупателю либо засчитывается при
            согласии покупателя на актуальную цену. Заказывая товар на сайте, вы подтверждаете, что
            прочитали эти условия и соглашаетесь с ними.
          </p>
        </div>
      </footer>

      {menuDrag.shouldRender && (
        <div
          className={`store-menu ${mobileMenuOpen ? "is-open" : ""} ${
            menuDrag.isDragging ? "is-dragging" : ""
          }`}
          role="dialog"
          aria-modal={mobileMenuOpen}
          aria-label="Мобильное меню"
        >
          <div
            className="store-menu__backdrop"
            style={menuDrag.backdropStyle}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            ref={menuRef}
            className="store-menu__sheet"
            style={menuDrag.sidebarStyle}
            onTouchStart={menuDrag.handlePanelTouchStart}
          >
            <div className="store-menu__head">
              <Link className="store-menu__brand" to="/" onClick={() => setMobileMenuOpen(false)}>
                <StoreLogo compact />
              </Link>
              <AppButton
                type="button"
                variant="ghost"
                className="store-menu__close icon-button"
                aria-label="Закрыть меню"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X size={20} />
              </AppButton>
            </div>
            <div className="store-menu__body">
              <NavLink to="/" onClick={() => setMobileMenuOpen(false)}>
                <Home size={22} />
                <span>Главная</span>
              </NavLink>
              <NavLink to="/catalog" onClick={() => setMobileMenuOpen(false)}>
                <LayoutGrid size={22} />
                <span>Каталог</span>
              </NavLink>
              <NavLink to="/cart" onClick={() => setMobileMenuOpen(false)}>
                <ShoppingCart size={22} />
                <span>Корзина ({cart.itemCount})</span>
              </NavLink>
              {user ? (
                <>
                  <NavLink to="/profile" onClick={() => setMobileMenuOpen(false)}>
                    <UserRound size={22} />
                    <span>Профиль · {formatMoney(user.balance)}</span>
                  </NavLink>
                  <NavLink to="/orders" onClick={() => setMobileMenuOpen(false)}>
                    <ClipboardList size={22} />
                    <span>Мои заказы</span>
                  </NavLink>
                </>
              ) : (
                <NavLink to="/login" onClick={() => setMobileMenuOpen(false)}>
                  <LogIn size={22} />
                  <span>Вход</span>
                </NavLink>
              )}
            </div>
            <div className="store-menu__footer">
              <a
                href={`tel:${supportPhone.replace(/\s/g, "")}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Phone size={20} />
                <span>{supportPhone}</span>
              </a>
              {user && (
                <AppButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    void logout();
                    setMobileMenuOpen(false);
                  }}
                >
                  <LogOut size={20} />
                  <span>Выйти</span>
                </AppButton>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
