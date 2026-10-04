import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Headphones, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { AppButton } from "@/shared/ui/AppButton";
import { Category } from "@/shared/types/models";
import { recordSearchQuery } from "@/shared/api/searchQueries";
import { StoreSearch } from "./StoreSearch";
import "./HomeHeroAlternative.css";

const steps = [
  { title: "Подберём", text: "Оборудование под задачу и бюджет" },
  { title: "Проверим", text: "Совместимость всех элементов" },
  { title: "Доставим", text: "Полную комплектацию на объект" },
];

export function HomeHeroAlternative({ categories }: { categories: Category[] }) {
  const [search, setSearch] = useState("");
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;
    let intersects = false;
    const updatePlayback = () => {
      // No React updates, scroll handlers, layout reads or animation recreation.
      visual.dataset.motionVisible = String(intersects && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersects = entry.isIntersecting;
      updatePlayback();
    });
    observer.observe(visual);
    document.addEventListener("visibilitychange", updatePlayback);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", updatePlayback);
    };
  }, []);

  return (
    <section className="home2-hero" aria-labelledby="home2-title">
      <div className="home2-hero__main">
        <div className="home2-hero__copy">
          <p className="home2-hero__eyebrow">
            <span /> Отопление / Водоснабжение / Сантехника
          </p>
          <h1 id="home2-title">
            Всё начинается
            <br />с <span>тепла.</span>
          </h1>
          <p className="home2-hero__description">
            Инженерные решения для вашего объекта. <br className="home2-hero__desktop-break" />
            От одного радиатора до полной комплектации — поможем собрать систему, в которой всё
            работает вместе.
          </p>
          <div className="home2-hero__actions">
            <AppButton asChild>
              <Link to="/catalog">
                Выбрать оборудование <ArrowRight size={18} />
              </Link>
            </AppButton>
            <AppButton asChild variant="ghost">
              <a href="tel:+77774593233">
                <Headphones size={18} /> Помощь специалиста
              </a>
            </AppButton>
          </div>
          <div className="home2-hero__search">
            <p id="home2-search-heading">Что нужно для вашего проекта?</p>
            <div role="search" aria-labelledby="home2-search-heading">
              <StoreSearch
                categories={categories}
                value={search}
                onValueChange={setSearch}
                placeholder="Товар или артикул"
                searchSource="HOME"
                onSearchCommitted={(query) => void recordSearchQuery({ query, source: "HOME" })}
              />
            </div>
            <span>Понимаем запросы на русском и казахском</span>
          </div>
        </div>
        <div ref={visualRef} className="home2-hero__visual">
          <div className="home2-hero__visual-top">
            <span>ПРОДУМАНО ДО ДЕТАЛЕЙ</span>
            <span className="home2-hero__live">
              <span /> Единая система
            </span>
          </div>
          <div className="home2-hero__scene" aria-hidden="true">
            <svg className="home2-hero__drawing" viewBox="0 0 520 370" fill="none">
              <defs>
                <linearGradient
                  id="home2-wall"
                  x1="100"
                  y1="100"
                  x2="400"
                  y2="340"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#314557" />
                  <stop offset="1" stopColor="#182c3e" />
                </linearGradient>
                <linearGradient
                  id="home2-roof"
                  x1="100"
                  y1="80"
                  x2="400"
                  y2="160"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#506575" />
                  <stop offset="1" stopColor="#273d50" />
                </linearGradient>
              </defs>
              <ellipse cx="269" cy="309" rx="190" ry="35" fill="#091725" opacity=".55" />
              <path d="M60 280 254 176 455 284 263 355Z" fill="#223749" stroke="#405569" />
              <path d="M106 156 263 76 415 158 260 242Z" fill="url(#home2-roof)" stroke="#81909a" />
              <path d="M106 156V271L260 348V242Z" fill="url(#home2-wall)" stroke="#627584" />
              <path d="M260 242 415 158V273L260 348Z" fill="#142a3c" stroke="#627584" />
              <path
                d="M91 153 253 47 430 154 263 67Z"
                fill="#405769"
                stroke="#9aa7ae"
                strokeLinejoin="round"
              />
              <path d="M91 153 253 47 263 67 106 168Z" fill="url(#home2-roof)" stroke="#9aa7ae" />
              <path d="M157 190v49l55 28v-49Z" fill="#ffc799" stroke="#ffe0c4" strokeWidth="2" />
              <path d="m184 205 1 48m-27-39 54 28" stroke="#8c6f5d" strokeWidth="3" />
              <path d="m286 245 46-24v67l-46 24Z" fill="#2b4559" stroke="#8095a3" />
              <path d="m354 209 35-18v40l-35 18Z" fill="#ffc799" stroke="#ffe0c4" strokeWidth="2" />
              <path
                d="M122 249v30l116 60v-37M278 326l112-57v-20"
                stroke="#ff9255"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="m135 257 91 46m-91-36 91 46m-91-36 91 46"
                stroke="#ff9255"
                strokeWidth="2"
                opacity=".7"
              />
              <path
                d="M276 316 377 264v-15"
                stroke="#6bbbd1"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle cx="122" cy="249" r="7" fill="#ff9255" stroke="#ffe4cf" strokeWidth="3" />
              <circle cx="390" cy="249" r="7" fill="#6bbbd1" stroke="#c6f1fc" strokeWidth="3" />
              <path
                d="M122 249 69 221H30M390 249l49-25h51M373 210l57-83h60"
                stroke="#97a9b7"
                strokeDasharray="3 5"
              />
            </svg>
            <span className="home2-hero__particle home2-hero__particle--heat" />
            <span className="home2-hero__particle home2-hero__particle--water" />
          </div>
          <span className="home2-hero__tag home2-hero__tag--heat">
            <span /> Отопление
          </span>
          <span className="home2-hero__tag home2-hero__tag--water">
            <span /> Водоснабжение
          </span>
          <div className="home2-hero__visual-bottom">
            <div>
              <span>ДЛЯ ДОМА И БИЗНЕСА</span>
              <strong>Комфорт — это система.</strong>
            </div>
            <ShieldCheck size={30} strokeWidth={1.4} />
          </div>
        </div>
      </div>
      <div className="home2-hero__footer">
        <div className="home2-hero__promise">
          <span>
            <Check size={18} />
          </span>
          <strong>
            Один партнёр.
            <br />
            От подбора до поставки.
          </strong>
        </div>
        <ol className="home2-hero__steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span>0{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
