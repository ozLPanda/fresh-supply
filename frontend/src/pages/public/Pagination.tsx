import { MouseEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppModal } from "@/shared/ui/AppFeedback";
import { buildPaginationRange } from "./store-utils";
import "./Pagination.css";

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const location = useLocation();
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const currentPageRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pagePickerOpen) return;

    const frame = window.requestAnimationFrame(() => {
      currentPageRef.current?.scrollIntoView({ block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [page, pagePickerOpen]);

  if (totalPages <= 1) return null;

  function selectPage(nextPage: number) {
    setPagePickerOpen(false);
    if (nextPage !== page) onPageChange(nextPage);
  }

  function pageLink(nextPage: number, content: ReactNode, className: string, label: string) {
    const params = new URLSearchParams(location.search);
    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");
    const query = params.toString();
    const href = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
    const disabled = nextPage < 1 || nextPage > totalPages;
    if (disabled) {
      return (
        <AppButton
          type="button"
          variant="secondary"
          className={className}
          disabled
          aria-label={label}
        >
          {content}
        </AppButton>
      );
    }
    return (
      <AppButton
        asChild
        variant={nextPage === page ? "primary" : "secondary"}
        className={className}
      >
        <a
          href={href}
          aria-label={label}
          aria-current={nextPage === page ? "page" : undefined}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            selectPage(nextPage);
          }}
        >
          {content}
        </a>
      </AppButton>
    );
  }

  return (
    <>
      <nav className="pagination" aria-label="Пагинация каталога">
        {pageLink(page - 1, <ChevronLeft size={16} />, "pagination__arrow", "Предыдущая страница")}
        {buildPaginationRange(page, totalPages).map((item, index) =>
          item === "ellipsis" ? (
            <AppButton
              key={`ellipsis-${index}`}
              type="button"
              variant="ghost"
              className="pagination__ellipsis"
              aria-label="Показать все страницы"
              aria-haspopup="dialog"
              aria-expanded={pagePickerOpen}
              onClick={() => setPagePickerOpen(true)}
            >
              <MoreHorizontal size={20} />
            </AppButton>
          ) : (
            <span key={item}>{pageLink(item, item, "pagination__page", `Страница ${item}`)}</span>
          ),
        )}
        {pageLink(page + 1, <ChevronRight size={16} />, "pagination__arrow", "Следующая страница")}
      </nav>

      <AppModal
        open={pagePickerOpen}
        onOpenChange={setPagePickerOpen}
        title="Выберите страницу"
        description={`Текущая страница: ${page} из ${totalPages}`}
        contentClassName="pagination-page-picker"
      >
        <div className="pagination-page-picker__scroll">
          <div className="pagination-page-picker__grid" role="group" aria-label="Все страницы">
            {Array.from({ length: totalPages }, (_, index) => {
              const itemPage = index + 1;
              const current = itemPage === page;

              return (
                <AppButton
                  key={itemPage}
                  ref={current ? currentPageRef : undefined}
                  type="button"
                  variant={current ? "primary" : "secondary"}
                  className="pagination-page-picker__page"
                  aria-current={current ? "page" : undefined}
                  onClick={() => selectPage(itemPage)}
                >
                  {itemPage}
                </AppButton>
              );
            })}
          </div>
        </div>
      </AppModal>
    </>
  );
}
