import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, WalletCards, CalendarDays, Plus, Trash2 } from "lucide-react";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import { todayInAlmaty } from "@/shared/lib/dateTime";
import {
  workEmployees,
  workView,
  workWrite,
  type WorkDay,
  type WorkView,
  type WorkPayment,
  type WorkTransaction,
  type WorkInterval,
  type WorkAdditionalPayment,
} from "@/shared/api/workTime";
import { AppButton } from "@/shared/ui/AppButton";
import { AppInput, AppSelect } from "@/shared/ui/AppField";
import { AppDatePicker, AppDateRangePicker, type AppDateRange } from "@/shared/ui/AppDatePicker";
import { AppAlert, AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppBadge } from "@/shared/ui/AppBadge";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import "./WorkTimePage.css";

const money = (n: number) =>
  new Intl.NumberFormat("ru-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 2,
  }).format(n);
const duration = (n: number) => `${Math.floor(n / 60)} ч ${n % 60} мин`;
const date = (s: string) => new Date(`${s}T12:00:00`);
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const label = (s: string) => date(s).toLocaleDateString("ru-RU");
const clock = (n: number) =>
  n === 1440
    ? "24:00"
    : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const parse = (s: string) => {
  if (!s) return -1;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const initialRange = () => {
  const to = date(todayInAlmaty());
  return { from: new Date(to.getFullYear(), to.getMonth(), 1, 12), to };
};
type Editor = {
  date: string;
  version: number;
  intervals: WorkInterval[];
  note: string;
  additionalPayments: WorkAdditionalPayment[];
  existing?: WorkDay;
};

export function WorkTimePage() {
  const { user } = useCommerce();
  const allowed = user?.permissions.some((p) =>
    ["pages.worktime.view", "worktime.manage"].includes(p),
  );
  const [chosen, setChosen] = useState<number | null>(null);
  const id = chosen ?? user?.id ?? 0;
  const [range, setRange] = useState<AppDateRange>(initialRange);
  const from = range.from ? key(range.from) : "",
    to = range.to ? key(range.to) : from;
  const valid = !!from && !!to && from <= to;
  const employees = useQuery({
    queryKey: ["work-time-employees"],
    queryFn: workEmployees,
    enabled: !!allowed,
  });
  const query = useQuery({
    queryKey: ["work-time", id, from, to],
    queryFn: () => workView(id, from, to),
    enabled: !!allowed && !!id && valid,
  });
  const cache = useQueryClient();
  const data = query.data;
  const hasSalary = (data?.settings.dailyRate ?? 0) > 0;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rate, setRate] = useState("");
  const [normH, setNormH] = useState("8");
  const [normM, setNormM] = useState("0");
  const [settingsVersion, setSettingsVersion] = useState(-1);
  const [action, setAction] = useState<"pay" | "reprice" | null>(null);
  const [payRange, setPayRange] = useState<AppDateRange>(initialRange);
  const payFrom = payRange.from ? key(payRange.from) : "",
    payTo = payRange.to ? key(payRange.to) : payFrom;
  const preview = useQuery({
    queryKey: ["work-time-preview", id, payFrom, payTo],
    queryFn: () => workView(id, payFrom, payTo),
    enabled: !!action && !!payFrom && !!payTo && payFrom <= payTo,
  });
  const [paidOn, setPaidOn] = useState<Date | undefined>(date(todayInAlmaty()));
  const [note, setNote] = useState("");
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [transactionAmount, setTransactionAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState<Date | undefined>(date(todayInAlmaty()));
  const [transactionNote, setTransactionNote] = useState("");
  const [cancel, setCancel] = useState<WorkPayment | null>(null);
  const [cancelTransaction, setCancelTransaction] = useState<WorkTransaction | null>(null);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState<WorkDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const run = async (fn: () => Promise<unknown>, message: string, close: () => void) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      close();
      await cache.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("work-time"),
      });
      setSuccess(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      await cache.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("work-time"),
      });
    } finally {
      setBusy(false);
    }
  };
  const openSettings = () => {
    if (!data) return;
    setError("");
    setRate(String(data.settings.dailyRate));
    setNormH(String(Math.floor(data.settings.normMinutes / 60)));
    setNormM(String(data.settings.normMinutes % 60));
    setSettingsVersion(data.settings.version);
    setSettingsOpen(true);
  };
  const openDay = (day?: WorkDay) => {
    if (!day && !hasSalary) {
      openSettings();
      return;
    }
    setError("");
    setEditor({
      date: day?.date ?? todayInAlmaty(),
      version: day?.version ?? -1,
      intervals: day?.intervals.map((i) => ({ ...i })) ?? [
        { start: 540, end: Math.min(1440, 540 + (data?.settings.normMinutes ?? 480)) },
      ],
      note: day?.note ?? "",
      additionalPayments: day?.additionalPayments.map((payment) => ({ ...payment })) ?? [],
      existing: day,
    });
  };
  const unpaid = preview.data?.days.filter((d) => d.paymentId === null) ?? [];
  const payTotal = unpaid.reduce((sum, d) => sum + d.amount, 0);
  const payableAmount = Math.min(payTotal, Math.max(0, preview.data?.balance.amount ?? 0));
  const paymentPayload = () => ({
    from: payFrom,
    to: payTo,
    expected: unpaid.map((d) => ({ id: d.id, version: d.version })),
    settingsVersion: preview.data?.settings.version,
    paidOn: paidOn ? key(paidOn) : null,
    note,
  });
  const openAction = (kind: "pay" | "reprice", all = false) => {
    setError("");
    setAction(kind);
    setNote("");
    setPaidOn(date(todayInAlmaty()));
    setPayRange(
      all && data?.balance.firstUnpaid
        ? { from: date(data.balance.firstUnpaid), to: date(data.balance.lastMarked!) }
        : range,
    );
  };
  const openTransaction = () => {
    setError("");
    setTransactionOpen(true);
    setTransactionAmount("");
    setTransactionDate(date(todayInAlmaty()));
    setTransactionNote("");
  };
  const columns: AppDataTableColumn<WorkDay>[] = [
    {
      id: "date",
      header: "День",
      accessor: "date",
      sortable: true,
      cell: (d) => (
        <div>
          <strong>{label(d.date)}</strong>
          <small className="work-time__sub">
            {date(d.date).toLocaleDateString("ru-RU", { weekday: "long" })}
          </small>
        </div>
      ),
    },
    {
      id: "intervals",
      header: "Приход → уход",
      cell: (d) => (
        <div className="work-time__interval-list">
          {d.intervals.map((i) => (
            <span key={i.start}>
              {clock(i.start)} → {clock(i.end)}
            </span>
          ))}
          {d.note && <small>{d.note}</small>}
        </div>
      ),
    },
    {
      id: "minutes",
      header: "Отработано",
      accessor: "minutes",
      sortable: true,
      cell: (d) => duration(d.minutes),
    },
    {
      id: "rate",
      header: "Условия дня",
      cell: (d) => (
        <span>
          {money(d.dailyRate)}
          <small className="work-time__sub">за {duration(d.normMinutes)}</small>
        </span>
      ),
    },
    {
      id: "amount",
      header: "Начислено",
      accessor: "amount",
      sortable: true,
      cell: (d) => <strong>{money(d.amount)}</strong>,
    },
    {
      id: "additional-payments",
      header: "Доплаты",
      cell: (d) =>
        d.additionalPayments.length ? (
          <div className="work-time__additional-payments">
            {d.additionalPayments.map((payment, index) => (
              <span key={`${payment.title}-${index}`}>
                {payment.title} · {money(payment.amount)}
              </span>
            ))}
          </div>
        ) : (
          "—"
        ),
    },
    {
      id: "status",
      header: "Статус",
      cell: (d) => (
        <AppBadge tone={d.paymentId ? "green" : d.dailyRate > 0 ? "orange" : "red"}>
          {d.paymentId ? "Выплачено" : d.dailyRate > 0 ? "К выплате" : "Оклад не задан"}
        </AppBadge>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: (d) =>
        !d.paymentId && (
          <div className="work-time__actions">
            <AppButton variant="ghost" onClick={() => openDay(d)}>
              Изменить
            </AppButton>
            <AppButton
              variant="ghost"
              aria-label={`Удалить день ${label(d.date)}`}
              onClick={() => {
                setError("");
                setDeleting(d);
              }}
            >
              <Trash2 size={16} />
            </AppButton>
          </div>
        ),
    },
  ];
  const editorMinutes =
    editor?.intervals.reduce((s, i) => s + Math.max(0, i.end - i.start), 0) ?? 0;
  const editorRate = editor?.existing?.dailyRate ?? data?.settings.dailyRate ?? 0;
  const editorNorm = editor?.existing?.normMinutes ?? data?.settings.normMinutes ?? 480;
  const editorAdditionalAmount =
    editor?.additionalPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) ??
    0;
  const editorTimeAmount = Math.round(((editorRate * editorMinutes) / editorNorm) * 100) / 100;
  const editorInvalid =
    !!editor &&
    editor.intervals
      .slice()
      .sort((a, b) => a.start - b.start)
      .some(
        (i, n, arr) =>
          i.start < 0 || i.end <= i.start || i.end > 1440 || (n > 0 && i.start < arr[n - 1].end),
      );
  const additionalPaymentsInvalid =
    !!editor &&
    editor.additionalPayments.some(
      (payment) =>
        !payment.title.trim() ||
        !Number.isFinite(Number(payment.amount)) ||
        Number(payment.amount) <= 0 ||
        Number(payment.amount) > 9_999_999.99,
    );
  const norm = Number(normH) * 60 + Number(normM);
  const modalError = error && (
    <AppAlert tone="danger" title="Не удалось выполнить действие">
      {error}
    </AppAlert>
  );
  if (!allowed)
    return (
      <AdminPage title="Рабочее время">
        <AppAlert tone="warning" title="Нет доступа">
          Нужно разрешение «Личный табель и начисления».
        </AppAlert>
      </AdminPage>
    );
  return (
    <AdminPage eyebrow="Команда · время · выплаты" title="Рабочее время">
      <div className="work-time">
        <div className="work-time__toolbar">
          <div>
            <h2>Каждая минута — в табеле</h2>
            <p>Отмечайте рабочие интервалы. Перерывы между ними не оплачиваются.</p>
          </div>
          <AppSelect
            label="Сотрудник"
            value={String(id)}
            options={(employees.data ?? []).map((e) => ({ value: String(e.id), label: e.name }))}
            searchable
            clearable={false}
            onValueChange={(v) => {
              setChosen(Number(v));
              setError("");
              setSuccess("");
            }}
          />
          <AppDateRangePicker
            label="Период табеля"
            value={range}
            onValueChange={(v) => setRange(v ?? initialRange())}
          />
          <AppButton
            onClick={() => openDay()}
            disabled={!data || !valid || query.isFetching || (!hasSalary && !data.canManage)}
          >
            <Plus size={16} />
            {hasSalary ? "Добавить день" : "Указать оклад"}
          </AppButton>
        </div>
        {employees.isError && (
          <AppAlert
            tone="danger"
            title="Не удалось загрузить сотрудников"
            onRetry={() => employees.refetch()}
          />
        )}
        {success && <AppAlert tone="success" title={success} />}
        {error &&
          !editor &&
          !settingsOpen &&
          !action &&
          !transactionOpen &&
          !cancel &&
          !cancelTransaction &&
          !deleting &&
          modalError}
        {!valid ? (
          <AppAlert tone="warning" title="Проверьте период" />
        ) : query.isError ? (
          <AppAlert
            tone="danger"
            title="Не удалось загрузить табель"
            onRetry={() => query.refetch()}
          >
            {query.error.message}
          </AppAlert>
        ) : !data ? (
          <AppSkeleton />
        ) : (
          <>
            <div className="work-time__balance">
              <div>
                <span className="work-time__eyebrow">Баланс сотрудника · за всё время</span>
                <strong>{money(data.balance.amount)}</strong>
                <p>
                  {data.balance.firstUnpaid
                    ? `${label(data.balance.firstUnpaid)} — ${label(data.balance.lastMarked!)} · неоплаченных дней: ${data.balance.days}`
                    : data.balance.lastMarked
                      ? "Все отмеченные дни оплачены"
                      : "Пока нет отмеченных дней"}
                </p>
                <small>
                  Учтены все начисления, выплаты за дни и выданные суммы без привязки к дням.
                </small>
              </div>
              {data.canManage && (
                <div className="work-time__balance-actions">
                  <AppButton onClick={openTransaction}>Выдать сумму</AppButton>
                  <AppButton
                    variant="ghost"
                    onClick={() => openAction("pay", true)}
                    disabled={!data.balance.days}
                  >
                    Выплатить за дни
                  </AppButton>
                </div>
              )}
            </div>
            {data.balance.unpricedDays > 0 && (
              <AppAlert tone="warning" title={`Без оклада: ${data.balance.unpricedDays} дней`}>
                Эти дни пока дают нулевое начисление. Ответственный может сохранить условия и
                применить их к неоплаченным дням.
              </AppAlert>
            )}
            {!hasSalary && data.balance.unpricedDays === 0 && (
              <AppAlert tone="warning" title="Сначала укажите оклад">
                {data.canManage
                  ? "Перед добавлением рабочего дня укажите оклад и норму времени сотрудника."
                  : "Перед добавлением рабочего дня ответственный должен указать оклад и норму времени."}
              </AppAlert>
            )}
            <div className="work-time__metrics">
              <MetricCard
                icon={<Clock3 />}
                label="Время за выбранный период"
                value={duration(data.days.reduce((s, d) => s + d.minutes, 0))}
              />
              <MetricCard icon={<CalendarDays />} label="Рабочих дней" value={data.days.length} />
              <MetricCard
                icon={<WalletCards />}
                label="Начислено за период"
                value={money(data.days.reduce((s, d) => s + d.amount, 0))}
              />
              <MetricCard
                icon={<WalletCards />}
                label="Из них выплачено"
                value={money(
                  data.days.filter((d) => d.paymentId).reduce((s, d) => s + d.amount, 0),
                )}
              />
            </div>
            <DataPanel
              title="Условия сотрудника"
              actions={
                data.canManage && (
                  <AppButton variant="secondary" onClick={openSettings}>
                    Настроить
                  </AppButton>
                )
              }
            >
              <div className="work-time__conditions">
                <strong>{money(data.settings.dailyRate)} / день</strong>
                <span>Норма: {duration(data.settings.normMinutes)}</span>
                <span>
                  Минута:{" "}
                  {new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 6 }).format(
                    data.settings.dailyRate / data.settings.normMinutes,
                  )}{" "}
                  ₸
                </span>
                <p>
                  Начисление = оклад × отработанные минуты ÷ норма. Более длинный день оплачивается
                  пропорционально, без повышающего коэффициента. Условия сохраняются отдельно в
                  каждом дне.
                </p>
              </div>
            </DataPanel>
            <DataPanel
              title={`Табель · ${data.name}`}
              actions={
                data.canManage && (
                  <AppButton
                    variant="ghost"
                    onClick={() => openAction("reprice")}
                    disabled={!data.days.some((d) => !d.paymentId)}
                  >
                    Применить условия к дням
                  </AppButton>
                )
              }
            >
              <AppDataTable
                data={data.days}
                columns={columns}
                rowId={(d) => String(d.id)}
                selectable={false}
                defaultPageSize={10}
                emptyTitle="Дни ещё не отмечены"
                emptyDescription="Добавьте день и интервалы прихода и ухода."
              />
            </DataPanel>
            <DataPanel
              title="История выплат"
              actions={
                <span className="work-time__sub">Выплаты, покрывающие дни выбранного периода</span>
              }
            >
              <div className="work-time__payments">
                {!data.payments.length ? (
                  <p>Отметок выплат за этот период пока нет.</p>
                ) : (
                  data.payments.map((p) => (
                    <div className="work-time__payment" key={p.id}>
                      <div>
                        <strong>{money(p.amount)}</strong>{" "}
                        <AppBadge tone={p.cancelledAt ? "slate" : "green"}>
                          {p.cancelledAt ? "Отменена" : "Выплачено"}
                        </AppBadge>
                        <p>
                          {label(p.from)} — {label(p.to)}
                        </p>
                        <small>
                          Дата выплаты: {label(p.paidOn)} · Отметил: {p.createdBy}
                        </small>
                        {p.note && <p>{p.note}</p>}
                        {p.cancelledAt && <p>Причина отмены: {p.cancelReason}</p>}
                      </div>
                      {data.canManage && !p.cancelledAt && (
                        <AppButton
                          variant="ghost"
                          onClick={() => {
                            setError("");
                            setReason("");
                            setCancel(p);
                          }}
                        >
                          Отменить отметку
                        </AppButton>
                      )}
                    </div>
                  ))
                )}
              </div>
            </DataPanel>
            <DataPanel
              title="Выданные суммы"
              actions={
                <span className="work-time__sub">
                  Выдачи за выбранный период, без привязки к дням
                </span>
              }
            >
              <div className="work-time__payments">
                {!data.transactions.length ? (
                  <p>Выданных сумм за этот период пока нет.</p>
                ) : (
                  data.transactions.map((transaction) => (
                    <div className="work-time__payment" key={transaction.id}>
                      <div>
                        <strong>{money(transaction.amount)}</strong>{" "}
                        <AppBadge tone={transaction.cancelledAt ? "slate" : "green"}>
                          {transaction.cancelledAt ? "Отменена" : "Выдано"}
                        </AppBadge>
                        <p>{label(transaction.occurredOn)}</p>
                        <small>Отметил: {transaction.createdBy}</small>
                        {transaction.note && <p>{transaction.note}</p>}
                        {transaction.cancelledAt && (
                          <p>Причина отмены: {transaction.cancelReason}</p>
                        )}
                      </div>
                      {data.canManage && !transaction.cancelledAt && (
                        <AppButton
                          variant="ghost"
                          onClick={() => {
                            setError("");
                            setReason("");
                            setCancelTransaction(transaction);
                          }}
                        >
                          Отменить отметку
                        </AppButton>
                      )}
                    </div>
                  ))
                )}
              </div>
            </DataPanel>
          </>
        )}
      </div>
      <AppModal
        open={!!editor}
        onOpenChange={(v) => {
          if (!v && !busy) setEditor(null);
        }}
        title={editor?.existing ? "Изменить рабочий день" : "Добавить рабочий день"}
        description="Записывайте фактические интервалы. Ночную смену разделите на два календарных дня."
      >
        {editor && (
          <form
            className="work-time__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (editorInvalid) return;
              void run(
                () =>
                  workWrite(id, `days/${editor.date}`, { ...editor, existing: undefined }, "PUT"),
                "Рабочий день сохранён",
                () => setEditor(null),
              );
            }}
          >
            {modalError}
            <AppDatePicker
              label="Рабочий день"
              value={date(editor.date)}
              onValueChange={(v) => v && setEditor({ ...editor, date: key(v) })}
              disabled={!!editor.existing || busy}
            />
            {editor.intervals.map((i, n) => (
              <div className="work-time__interval" key={n}>
                <AppInput
                  label="Приход"
                  type="time"
                  required
                  value={i.start < 0 ? "" : clock(i.start)}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      intervals: editor.intervals.map((x, k) =>
                        k === n ? { ...x, start: parse(e.target.value) } : x,
                      ),
                    })
                  }
                />
                <AppInput
                  label="Уход"
                  type="time"
                  required
                  value={i.end < 0 ? "" : clock(i.end === 1440 ? 0 : i.end)}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      intervals: editor.intervals.map((x, k) =>
                        k === n
                          ? { ...x, end: e.target.value === "00:00" ? 1440 : parse(e.target.value) }
                          : x,
                      ),
                    })
                  }
                />
                <AppButton
                  type="button"
                  variant="ghost"
                  disabled={editor.intervals.length === 1 || busy}
                  aria-label={`Убрать интервал ${n + 1}`}
                  onClick={() =>
                    setEditor({ ...editor, intervals: editor.intervals.filter((_, k) => k !== n) })
                  }
                >
                  <Trash2 size={17} />
                </AppButton>
              </div>
            ))}
            <small>Уход в 00:00 означает конец выбранного дня (24:00).</small>
            <AppButton
              type="button"
              variant="secondary"
              disabled={editor.intervals.length >= 24 || busy}
              onClick={() =>
                setEditor({ ...editor, intervals: [...editor.intervals, { start: -1, end: -1 }] })
              }
            >
              <Plus size={15} />
              Ещё интервал
            </AppButton>
            {editorInvalid && (
              <AppAlert tone="warning" title="Проверьте интервалы">
                Уход должен быть позже прихода, интервалы не должны пересекаться.
              </AppAlert>
            )}
            <AppInput
              label="Примечание"
              maxLength={1000}
              value={editor.note}
              onChange={(e) => setEditor({ ...editor, note: e.target.value })}
            />
            <div className="work-time__additional-editor">
              <div>
                <strong>Дополнительные начисления</strong>
                <small>Например, премия или компенсация. Они войдут в сумму к выплате.</small>
              </div>
              {editor.additionalPayments.map((payment, index) => (
                <div className="work-time__additional-row" key={index}>
                  <AppInput
                    label="Наименование"
                    required
                    maxLength={255}
                    value={payment.title}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        additionalPayments: editor.additionalPayments.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, title: e.target.value } : item,
                        ),
                      })
                    }
                  />
                  <AppInput
                    label="Сумма, ₸"
                    type="number"
                    required
                    min={0.01}
                    max={9999999.99}
                    step="0.01"
                    value={payment.amount}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        additionalPayments: editor.additionalPayments.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, amount: Number(e.target.value) } : item,
                        ),
                      })
                    }
                  />
                  <AppButton
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Удалить дополнительное начисление ${index + 1}`}
                    onClick={() =>
                      setEditor({
                        ...editor,
                        additionalPayments: editor.additionalPayments.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={17} />
                  </AppButton>
                </div>
              ))}
              <AppButton
                type="button"
                variant="secondary"
                disabled={editor.additionalPayments.length >= 50 || busy}
                onClick={() =>
                  setEditor({
                    ...editor,
                    additionalPayments: [...editor.additionalPayments, { title: "", amount: 0 }],
                  })
                }
              >
                <Plus size={15} />
                Добавить доплату
              </AppButton>
            </div>
            {additionalPaymentsInvalid && (
              <AppAlert tone="warning" title="Проверьте доплаты">
                Укажите наименование и сумму больше нуля для каждой доплаты.
              </AppAlert>
            )}
            <div className="work-time__estimate">
              {duration(editorMinutes)} · {money(editorTimeAmount + editorAdditionalAmount)}
              <small>
                За время: {money(editorTimeAmount)} · Доплаты: {money(editorAdditionalAmount)}
              </small>
            </div>
            <AppButton
              type="submit"
              loading={busy}
              disabled={editorInvalid || additionalPaymentsInvalid || editor.date > todayInAlmaty()}
            >
              Сохранить день
            </AppButton>
          </form>
        )}
      </AppModal>
      <AppModal
        open={settingsOpen}
        onOpenChange={(v) => !busy && setSettingsOpen(v)}
        title="Оклад и норма сотрудника"
        description="Новые условия используются при добавлении дней. Старые дни автоматически не пересчитываются."
      >
        <form
          className="work-time__form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                workWrite(
                  id,
                  "settings",
                  { dailyRate: Number(rate), normMinutes: norm, version: settingsVersion },
                  "PUT",
                ),
              "Условия сохранены",
              () => setSettingsOpen(false),
            );
          }}
        >
          {modalError}
          <AppInput
            label="Дневной оклад, ₸"
            type="number"
            min={0}
            max={9999999.99}
            step="0.01"
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <div className="work-time__interval">
            <AppInput
              label="Норма: часов"
              type="number"
              min={0}
              max={24}
              step={1}
              required
              value={normH}
              onChange={(e) => setNormH(e.target.value)}
            />
            <AppInput
              label="Минут"
              type="number"
              min={0}
              max={59}
              step={1}
              required
              value={normM}
              onChange={(e) => setNormM(e.target.value)}
            />
          </div>
          <p>
            Стоимость минуты: {norm > 0 ? money(Number(rate) / norm) : "—"}. В расчёте используется
            точное отношение; округляется сумма за день.
          </p>
          <AppButton type="submit" loading={busy} disabled={norm < 1 || norm > 1440}>
            Сохранить условия
          </AppButton>
        </form>
      </AppModal>
      <AppModal
        open={!!action}
        onOpenChange={(v) => {
          if (!v && !busy) setAction(null);
        }}
        title={action === "pay" ? "Отметить выплату" : "Пересчитать неоплаченные дни"}
        description={
          action === "pay"
            ? "Это учёт уже выплаченных денег, без банковского перевода. Оплаченные дни не будут начислены повторно."
            : "Применяются текущий оклад и норма сотрудника. Оплаченные дни останутся без изменений."
        }
      >
        <div className="work-time__form">
          {modalError}
          <AppDateRangePicker
            label="Какие дни включить"
            value={payRange}
            onValueChange={(v) => setPayRange(v ?? range)}
          />
          {preview.isError ? (
            <AppAlert
              tone="danger"
              title="Не удалось загрузить дни"
              onRetry={() => preview.refetch()}
            />
          ) : preview.isFetching ? (
            <AppSkeleton />
          ) : (
            <>
              <strong>
                Неоплаченных дней: {unpaid.length} ·{" "}
                {duration(unpaid.reduce((s, d) => s + d.minutes, 0))}
              </strong>
              <div className="work-time__estimate">
                {action === "pay"
                  ? `К выплате: ${money(payableAmount)}`
                  : `${money(payTotal)} → ${money(unpaid.reduce((s, d) => s + Math.round((((preview.data?.settings.dailyRate ?? 0) * d.minutes) / (preview.data?.settings.normMinutes ?? 480)) * 100) / 100, 0))}`}
              </div>
              {action === "pay" && payableAmount !== payTotal && (
                <small>Ранее выданные суммы уже учтены, поэтому к выплате только разница.</small>
              )}
              <div className="work-time__preview">
                {unpaid.map((d) => (
                  <span key={d.id}>
                    {label(d.date)} · {duration(d.minutes)} · {money(d.amount)}
                  </span>
                ))}
              </div>
            </>
          )}
          {action === "pay" && (
            <>
              <AppDatePicker label="Когда выплачено" value={paidOn} onValueChange={setPaidOn} />
              <AppInput
                label="Примечание к выплате"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          )}
          <AppButton
            loading={busy}
            disabled={
              preview.isFetching ||
              preview.isError ||
              !unpaid.length ||
              !payFrom ||
              !payTo ||
              payFrom > payTo ||
              (action === "pay" && (!paidOn || unpaid.some((d) => d.dailyRate <= 0)))
            }
            onClick={() =>
              void run(
                () => workWrite(id, action === "pay" ? "payments" : "reprice", paymentPayload()),
                action === "pay" ? "Выплата отмечена" : "Неоплаченные дни пересчитаны",
                () => setAction(null),
              )
            }
          >
            {action === "pay" ? "Подтвердить выплату" : "Применить и пересчитать"}
          </AppButton>
          {action === "pay" && unpaid.some((d) => d.dailyRate <= 0) && (
            <AppAlert tone="warning" title="Есть дни без оклада">
              Сначала сохраните условия и примените их к этим дням.
            </AppAlert>
          )}
        </div>
      </AppModal>
      <AppModal
        open={transactionOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setTransactionOpen(false);
        }}
        title="Выдать сумму"
        description="Сумма изменит баланс сотрудника, но не будет привязана к рабочим дням."
      >
        <form
          className="work-time__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!transactionDate) return;
            void run(
              () =>
                workWrite(id, "transactions", {
                  occurredOn: key(transactionDate),
                  amount: Number(transactionAmount),
                  note: transactionNote,
                }),
              "Сумма выдана",
              () => setTransactionOpen(false),
            );
          }}
        >
          {modalError}
          <AppInput
            label="Сумма, ₸"
            type="number"
            required
            min={0.01}
            max={9999999.99}
            step="0.01"
            value={transactionAmount}
            onChange={(event) => setTransactionAmount(event.target.value)}
          />
          <AppDatePicker
            label="Когда выдано"
            value={transactionDate}
            onValueChange={setTransactionDate}
          />
          <AppInput
            label="Примечание"
            maxLength={1000}
            value={transactionNote}
            onChange={(event) => setTransactionNote(event.target.value)}
          />
          <AppButton
            type="submit"
            loading={busy}
            disabled={
              !transactionDate ||
              !Number.isFinite(Number(transactionAmount)) ||
              Number(transactionAmount) <= 0 ||
              Number(transactionAmount) > 9_999_999.99
            }
          >
            Выдать сумму
          </AppButton>
        </form>
      </AppModal>
      <AppModal
        open={!!cancel}
        onOpenChange={(v) => {
          if (!v && !busy) setCancel(null);
        }}
        title="Отменить отметку выплаты"
        description="Дни снова станут неоплаченными. Запись и причина отмены останутся в истории."
      >
        <div className="work-time__form">
          {modalError}
          <strong>{cancel && money(cancel.amount)}</strong>
          <AppInput
            label="Причина отмены"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
          <AppButton
            variant="danger"
            loading={busy}
            disabled={!reason.trim()}
            onClick={() =>
              cancel &&
              void run(
                () => workWrite(id, `payments/${cancel.id}/cancel`, { reason }),
                "Отметка выплаты отменена",
                () => setCancel(null),
              )
            }
          >
            Отменить отметку
          </AppButton>
        </div>
      </AppModal>
      <AppModal
        open={!!cancelTransaction}
        onOpenChange={(open) => {
          if (!open && !busy) setCancelTransaction(null);
        }}
        title="Отменить отдельную операцию"
        description="Запись и причина отмены останутся в истории. Остатки будут пересчитаны."
      >
        <div className="work-time__form">
          {modalError}
          <strong>{cancelTransaction && money(cancelTransaction.amount)} · выданная сумма</strong>
          <AppInput
            label="Причина отмены"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
          <AppButton
            variant="danger"
            loading={busy}
            disabled={!reason.trim()}
            onClick={() =>
              cancelTransaction &&
              void run(
                () => workWrite(id, `transactions/${cancelTransaction.id}/cancel`, { reason }),
                "Операция отменена",
                () => setCancelTransaction(null),
              )
            }
          >
            Отменить операцию
          </AppButton>
        </div>
      </AppModal>
      <AppModal
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v && !busy) setDeleting(null);
        }}
        title="Удалить рабочий день"
        description="Интервалы и начисление этого неоплаченного дня будут удалены."
      >
        <div className="work-time__form">
          {modalError}
          <strong>{deleting && label(deleting.date)}</strong>
          <AppButton
            variant="danger"
            loading={busy}
            onClick={() =>
              deleting &&
              void run(
                () =>
                  workWrite(
                    id,
                    `days/${deleting.date}?version=${deleting.version}`,
                    undefined,
                    "DELETE",
                  ),
                "День удалён",
                () => setDeleting(null),
              )
            }
          >
            Удалить день
          </AppButton>
        </div>
      </AppModal>
    </AdminPage>
  );
}
