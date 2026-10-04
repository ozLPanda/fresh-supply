import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import "./NotFoundPage.css";

export function NotFoundPage() {
  return (
    <main className="not-found-page">
      <AppCard className="not-found-page__card">
        <Compass className="not-found-page__icon" size={32} aria-hidden="true" />
        <p className="not-found-page__code">404</p>
        <h1>Страница не найдена</h1>
        <p>Возможно, адрес введён неверно или страница больше недоступна.</p>
        <AppButton asChild type="button">
          <Link to="/">На главную</Link>
        </AppButton>
      </AppCard>
    </main>
  );
}
