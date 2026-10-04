import { useMemo, useState } from "react";
import {
  addMonths,
  addYears,
  format,
  getMonth,
  getYear,
  setMonth,
  setYear,
  startOfMonth,
  subMonths,
  subYears,
} from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DateRange } from "react-day-picker";

type CalendarView = "days" | "months" | "years";

const monthNames = Array.from({ length: 12 }, (_, month) =>
  format(new Date(2026, month, 1), "LLLL", { locale: ru }),
);

function yearPageStart(year: number) {
  return Math.floor(year / 12) * 12;
}

function CalendarHeader({
  view,
  month,
  onPrevious,
  onNext,
  onTitleClick,
}: {
  view: CalendarView;
  month: Date;
  onPrevious: () => void;
  onNext: () => void;
  onTitleClick: () => void;
}) {
  const year = getYear(month);
  const title =
    view === "days"
      ? format(month, "LLLL yyyy", { locale: ru })
      : view === "months"
        ? String(year)
        : `${yearPageStart(year)}–${yearPageStart(year) + 11}`;

  return (
    <div className="app-calendar__header">
      <button type="button" onClick={onPrevious} aria-label="Предыдущий период">
        <ChevronLeft size={18} />
      </button>
      <button type="button" className="app-calendar__title" onClick={onTitleClick}>
        {title}
      </button>
      <button type="button" onClick={onNext} aria-label="Следующий период">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export function Calendar({
  mode,
  selected,
  onSelect,
  initialMonth,
}:
  | {
      mode: "single";
      selected?: Date;
      onSelect: (date?: Date) => void;
      initialMonth?: Date;
    }
  | {
      mode: "range";
      selected?: DateRange;
      onSelect: (range?: DateRange) => void;
      initialMonth?: Date;
    }) {
  const selectedMonth = mode === "single" ? selected : selected?.from;
  const [month, setDisplayedMonth] = useState(() =>
    startOfMonth(selectedMonth ?? initialMonth ?? new Date()),
  );
  const [view, setView] = useState<CalendarView>("days");

  const years = useMemo(() => {
    const start = yearPageStart(getYear(month));
    return Array.from({ length: 12 }, (_, index) => start + index);
  }, [month]);

  function previous() {
    if (view === "days") setDisplayedMonth((current) => subMonths(current, 1));
    if (view === "months") setDisplayedMonth((current) => subYears(current, 1));
    if (view === "years") setDisplayedMonth((current) => subYears(current, 12));
  }

  function next() {
    if (view === "days") setDisplayedMonth((current) => addMonths(current, 1));
    if (view === "months") setDisplayedMonth((current) => addYears(current, 1));
    if (view === "years") setDisplayedMonth((current) => addYears(current, 12));
  }

  function openHigherLevel() {
    if (view === "days") setView("months");
    else if (view === "months") setView("years");
  }

  return (
    <div className="app-calendar">
      <CalendarHeader
        view={view}
        month={month}
        onPrevious={previous}
        onNext={next}
        onTitleClick={openHigherLevel}
      />

      {view === "months" && (
        <div
          className="app-calendar__view app-calendar__view--picker app-calendar__picker-grid"
          key={`months-${getYear(month)}`}
        >
          {monthNames.map((name, monthIndex) => (
            <button
              type="button"
              key={name}
              className={monthIndex === getMonth(month) ? "active" : ""}
              onClick={() => {
                setDisplayedMonth((current) => setMonth(current, monthIndex));
                setView("days");
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {view === "years" && (
        <div
          className="app-calendar__view app-calendar__view--picker app-calendar__picker-grid"
          key={`years-${yearPageStart(getYear(month))}`}
        >
          {years.map((year) => (
            <button
              type="button"
              key={year}
              className={year === getYear(month) ? "active" : ""}
              onClick={() => {
                setDisplayedMonth((current) => setYear(current, year));
                setView("months");
              }}
            >
              {year}
            </button>
          ))}
        </div>
      )}

      {view === "days" &&
        (mode === "single" ? (
          <div
            className="app-calendar__view app-calendar__view--days"
            key={`days-${getYear(month)}-${getMonth(month)}`}
          >
            <DayPicker
              mode="single"
              locale={ru}
              month={month}
              onMonthChange={setDisplayedMonth}
              selected={selected}
              onSelect={onSelect}
              showOutsideDays
              hideNavigation
              classNames={calendarClassNames}
            />
          </div>
        ) : (
          <div
            className="app-calendar__view app-calendar__view--days"
            key={`range-days-${getYear(month)}-${getMonth(month)}`}
          >
            <DayPicker
              mode="range"
              locale={ru}
              month={month}
              onMonthChange={setDisplayedMonth}
              selected={selected}
              onSelect={onSelect}
              showOutsideDays
              hideNavigation
              classNames={calendarClassNames}
            />
          </div>
        ))}
    </div>
  );
}

const calendarClassNames = {
  root: "app-calendar__days",
  months: "app-calendar__months",
  month: "app-calendar__month",
  month_caption: "app-calendar__native-caption",
  month_grid: "app-calendar__month-grid",
  weekdays: "app-calendar__weekdays",
  weekday: "app-calendar__weekday",
  week: "app-calendar__week",
  day: "app-calendar__day",
  day_button: "app-calendar__day-button",
  selected: "is-selected",
  range_start: "is-range-start",
  range_middle: "is-range-middle",
  range_end: "is-range-end",
  today: "is-today",
  outside: "is-outside",
  disabled: "is-disabled",
  hidden: "is-hidden",
};
