import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, CheckCircle2, Printer } from "lucide-react";
import { API_URL, api } from "@/shared/api/http";
import { Order } from "@/shared/types/models";
import { AppButton } from "@/shared/ui/AppButton";
import { AppMoneyInput, AppTextarea } from "@/shared/ui/AppField";
import { AppRadioGroup } from "@/shared/ui/AppControls";
import { AppAlert, AppModal, AppTooltip } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import { formatMoney } from "@/pages/public/store-utils";
import "./OrderCompletionFlow.css";

type PaymentMethod = "CASH" | "CASHLESS" | "KASPI_STORE" | "MIXED";
type CashlessPaymentType = "TRANSFER" | "CARD" | "QR";
type Phase = "CONFIRM" | "PAYMENT" | "PRINT_DECISION" | "PRINT_OPTIONS" | null;

function paymentDescription(
  paymentMethod: PaymentMethod,
  cashlessPaymentType: CashlessPaymentType,
  cashAmount: number | null,
  transferAmount: number | null,
  cardAmount: number | null,
  qrAmount: number | null,
) {
  if (paymentMethod === "CASH") return "наличный расчёт";
  if (paymentMethod === "KASPI_STORE") return "Kaspi Магазин";
  if (paymentMethod === "CASHLESS") {
    return { TRANSFER: "перевод", CARD: "картой", QR: "QR" }[cashlessPaymentType];
  }

  const parts = [`комбинированный расчёт: наличными ${cashAmount ?? 0}`];
  if ((transferAmount ?? 0) > 0) parts.push(`перевод ${transferAmount}`);
  if ((cardAmount ?? 0) > 0) parts.push(`картой ${cardAmount}`);
  if ((qrAmount ?? 0) > 0) parts.push(`QR ${qrAmount}`);
  return parts.join(", ");
}

function printComment(
  invoiceTemplate: string,
  paymentMethod: PaymentMethod,
  cashlessPaymentType: CashlessPaymentType,
  cashAmount: number | null,
  transferAmount: number | null,
  cardAmount: number | null,
  qrAmount: number | null,
) {
  return [
    invoiceTemplate.trim(),
    paymentDescription(
      paymentMethod,
      cashlessPaymentType,
      cashAmount,
      transferAmount,
      cardAmount,
      qrAmount,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

async function openInvoice(order: Order, includePrintComment: boolean) {
  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) {
    appToast.error("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
    return;
  }

  previewWindow.document.title = "Загрузка накладной…";
  previewWindow.document.body.textContent = "Загружаем накладную…";
  const query = includePrintComment ? "" : "?includePrintComment=false";
  try {
    const response = await fetch(`${API_URL}/api/admin/orders/${order.id}/invoice.pdf${query}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Не удалось загрузить накладную");
    const url = URL.createObjectURL(await response.blob());
    previewWindow.location.replace(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
  } catch (error) {
    previewWindow.close();
    appToast.error(error instanceof Error ? error.message : "Не удалось открыть накладную");
  }
}

function PaymentAmountField({
  label,
  value,
  onValueChange,
  onFillRemainder,
}: {
  label: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  onFillRemainder: () => void;
}) {
  const tooltip = `Заполнить остаток в поле «${label}»`;
  return (
    <div className="order-completion-flow__amount-field">
      <AppMoneyInput label={label} value={value} onValueChange={onValueChange} />
      <AppTooltip content={tooltip}>
        <AppButton
          type="button"
          variant="secondary"
          className="order-completion-flow__remainder-button"
          aria-label={tooltip}
          onClick={onFillRemainder}
        >
          <Calculator size={17} />
        </AppButton>
      </AppTooltip>
    </div>
  );
}

export function OrderCompletionFlow({
  order,
  open,
  onOpenChange,
  onCompleted,
  canReleaseWithStockShortage = false,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: (order: Order) => void;
  canReleaseWithStockShortage?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [cashlessPaymentType, setCashlessPaymentType] = useState<CashlessPaymentType>("TRANSFER");
  const [cashAmount, setCashAmount] = useState<number | null>(null);
  const [transferAmount, setTransferAmount] = useState<number | null>(null);
  const [cardAmount, setCardAmount] = useState<number | null>(null);
  const [qrAmount, setQrAmount] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [invoiceComment, setInvoiceComment] = useState("");
  const [stockShortageReleaseOpen, setStockShortageReleaseOpen] = useState(false);
  const [stockShortageComment, setStockShortageComment] = useState("");
  const settingsQuery = useQuery({
    queryKey: ["my-order-settings"],
    queryFn: () => api<{ invoiceTemplate: string }>("/api/auth/order-settings"),
    enabled: phase === "PAYMENT",
  });

  useEffect(() => {
    if (!open || !order) {
      setPhase(null);
      setStockShortageReleaseOpen(false);
      return;
    }
    setPhase("CONFIRM");
    setPaymentMethod("CASH");
    setCashlessPaymentType("TRANSFER");
    setCashAmount(null);
    setTransferAmount(null);
    setCardAmount(null);
    setQrAmount(null);
    setComment(order.comment ?? "");
    setInvoiceComment("");
    setStockShortageReleaseOpen(false);
    setStockShortageComment("");
  }, [open, order?.id]);

  useEffect(() => {
    if (phase !== "PAYMENT") return;
    setInvoiceComment(
      printComment(
        settingsQuery.data?.invoiceTemplate ?? "",
        paymentMethod,
        cashlessPaymentType,
        cashAmount,
        transferAmount,
        cardAmount,
        qrAmount,
      ),
    );
  }, [
    cardAmount,
    cashAmount,
    cashlessPaymentType,
    paymentMethod,
    phase,
    qrAmount,
    settingsQuery.data?.invoiceTemplate,
    transferAmount,
  ]);

  const mixedTotal =
    (cashAmount ?? 0) + (transferAmount ?? 0) + (cardAmount ?? 0) + (qrAmount ?? 0);
  const mixedPaymentMatchesOrder =
    Boolean(order) &&
    cashAmount !== null &&
    cashAmount > 0 &&
    (transferAmount ?? 0) + (cardAmount ?? 0) + (qrAmount ?? 0) > 0 &&
    Math.abs(mixedTotal - (order?.total ?? 0)) < 0.005;

  const completePayment = useMutation({
    mutationFn: (releaseWithStockShortage: boolean) => {
      if (!order) throw new Error("Заказ не найден");
      return api<Order>(`/api/admin/orders/${order.id}/complete-payment`, {
        method: "POST",
        body: JSON.stringify({
          paymentMethod,
          cashAmount: paymentMethod === "MIXED" ? cashAmount : null,
          cashlessAmount: null,
          cashlessPaymentType: paymentMethod === "CASHLESS" ? cashlessPaymentType : null,
          transferAmount: paymentMethod === "MIXED" ? transferAmount : null,
          cardAmount: paymentMethod === "MIXED" ? cardAmount : null,
          qrAmount: paymentMethod === "MIXED" ? qrAmount : null,
          comment: comment.trim() || null,
          printComment: invoiceComment.trim() || null,
          releaseWithStockShortage,
          stockShortageComment: releaseWithStockShortage
            ? stockShortageComment.trim() || null
            : null,
        }),
      });
    },
    onSuccess: (completedOrder) => {
      onCompleted(completedOrder);
      setStockShortageReleaseOpen(false);
      setPhase("PRINT_DECISION");
      appToast.success("Оплата принята, заказ завершён");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось завершить оплату заказа"),
  });

  const fillRemainder = (target: "cash" | "transfer" | "card" | "qr") => {
    if (!order) return;
    const values = {
      cash: cashAmount ?? 0,
      transfer: transferAmount ?? 0,
      card: cardAmount ?? 0,
      qr: qrAmount ?? 0,
    };
    const remainder = Math.max(
      0,
      order.total - Object.values(values).reduce((sum, value) => sum + value, 0) + values[target],
    );
    if (target === "cash") setCashAmount(remainder);
    if (target === "transfer") setTransferAmount(remainder);
    if (target === "card") setCardAmount(remainder);
    if (target === "qr") setQrAmount(remainder);
  };

  const completionDescription = useMemo(
    () =>
      order
        ? `Заказ № ${order.displayCode} на сумму ${formatMoney(order.total)} будет оплачен и завершён.`
        : undefined,
    [order],
  );
  const close = () => onOpenChange(false);

  if (!order) return null;

  return (
    <>
      <AppModal
        title="Принять оплату и завершить заказ?"
        description={completionDescription}
        open={phase === "CONFIRM"}
        onOpenChange={(nextOpen) => !nextOpen && close()}
      >
        <div className="order-completion-flow__actions">
          <AppButton type="button" variant="secondary" onClick={close}>
            Отмена
          </AppButton>
          <AppButton type="button" onClick={() => setPhase("PAYMENT")}>
            Продолжить
          </AppButton>
        </div>
      </AppModal>

      <AppModal
        title="Принять оплату"
        description="Выберите способ оплаты и при необходимости заполните оба комментария."
        open={phase === "PAYMENT"}
        onOpenChange={(nextOpen) => !nextOpen && close()}
        contentClassName="order-completion-flow"
      >
        <AppRadioGroup
          label="Способ оплаты"
          value={paymentMethod}
          onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
          options={[
            { value: "CASH", label: "Наличный расчёт" },
            { value: "CASHLESS", label: "Безналичный расчёт" },
            { value: "KASPI_STORE", label: "Kaspi Магазин" },
            { value: "MIXED", label: "Комбинированный расчёт" },
          ]}
        />
        {paymentMethod === "CASHLESS" && (
          <AppRadioGroup
            label="Вид безналичного расчёта"
            value={cashlessPaymentType}
            onValueChange={(value) => setCashlessPaymentType(value as CashlessPaymentType)}
            options={[
              { value: "TRANSFER", label: "Перевод" },
              { value: "CARD", label: "Картой" },
              { value: "QR", label: "QR" },
            ]}
          />
        )}
        {paymentMethod === "MIXED" && (
          <div className="order-completion-flow__amounts">
            <PaymentAmountField
              label="Наличный расчёт"
              value={cashAmount}
              onValueChange={setCashAmount}
              onFillRemainder={() => fillRemainder("cash")}
            />
            <PaymentAmountField
              label="Перевод"
              value={transferAmount}
              onValueChange={setTransferAmount}
              onFillRemainder={() => fillRemainder("transfer")}
            />
            <PaymentAmountField
              label="Картой"
              value={cardAmount}
              onValueChange={setCardAmount}
              onFillRemainder={() => fillRemainder("card")}
            />
            <PaymentAmountField
              label="QR"
              value={qrAmount}
              onValueChange={setQrAmount}
              onFillRemainder={() => fillRemainder("qr")}
            />
            <span>
              Указано: {formatMoney(mixedTotal)} из {formatMoney(order.total)}
            </span>
            {!mixedPaymentMatchesOrder && (
              <AppAlert title="Сумма не совпадает" tone="warning">
                Укажите наличные и хотя бы один безналичный способ так, чтобы их сумма была равна
                итогу заказа.
              </AppAlert>
            )}
          </div>
        )}
        <AppTextarea
          label="Комментарий к заказу"
          value={comment}
          maxLength={2_000}
          rows={3}
          placeholder="Необязательно"
          onChange={(event) => setComment(event.target.value)}
        />
        <AppTextarea
          label="Комментарий для печати в накладной"
          value={invoiceComment}
          maxLength={2_000}
          rows={3}
          onChange={(event) => setInvoiceComment(event.target.value)}
        />
        <div className="order-completion-flow__actions">
          <AppButton
            type="button"
            variant="secondary"
            disabled={completePayment.isPending}
            onClick={close}
          >
            Отмена
          </AppButton>
          <AppButton
            type="button"
            loading={completePayment.isPending}
            loadingText="Завершаем…"
            disabled={paymentMethod === "MIXED" && !mixedPaymentMatchesOrder}
            onClick={() => completePayment.mutate(false)}
          >
            <CheckCircle2 size={18} />
            Принять оплату и завершить
          </AppButton>
          {canReleaseWithStockShortage && (
            <AppButton
              type="button"
              variant="danger"
              disabled={
                completePayment.isPending ||
                (paymentMethod === "MIXED" && !mixedPaymentMatchesOrder)
              }
              onClick={() => setStockShortageReleaseOpen(true)}
            >
              Отпустить с расхождением
            </AppButton>
          )}
        </div>
      </AppModal>

      <AppModal
        title="Отпустить с расхождением?"
        description="Система повторно проверит остатки и отметит только позиции, которых не хватает. Будут сохранены сотрудник и время отпуска."
        open={stockShortageReleaseOpen}
        onOpenChange={setStockShortageReleaseOpen}
        contentClassName="order-completion-flow"
      >
        <AppTextarea
          label="Комментарий к расхождению"
          value={stockShortageComment}
          maxLength={2_000}
          rows={3}
          placeholder="Необязательно"
          onChange={(event) => setStockShortageComment(event.target.value)}
        />
        <div className="order-completion-flow__actions">
          <AppButton
            type="button"
            variant="secondary"
            disabled={completePayment.isPending}
            onClick={() => setStockShortageReleaseOpen(false)}
          >
            Отмена
          </AppButton>
          <AppButton
            type="button"
            variant="danger"
            loading={completePayment.isPending}
            loadingText="Завершаем…"
            disabled={
              !canReleaseWithStockShortage ||
              (paymentMethod === "MIXED" && !mixedPaymentMatchesOrder)
            }
            onClick={() => completePayment.mutate(true)}
          >
            Подтвердить отпуск
          </AppButton>
        </div>
      </AppModal>

      <AppModal
        title="Печатать накладную?"
        description="Заказ успешно завершён. При необходимости можно сразу открыть накладную для печати."
        open={phase === "PRINT_DECISION"}
        onOpenChange={(nextOpen) => !nextOpen && close()}
      >
        <div className="order-completion-flow__actions">
          <AppButton type="button" variant="secondary" onClick={close}>
            Не сейчас
          </AppButton>
          <AppButton type="button" onClick={() => setPhase("PRINT_OPTIONS")}>
            <Printer size={18} />
            Выбрать вариант печати
          </AppButton>
        </div>
      </AppModal>

      <AppModal
        title="Вариант накладной"
        description="Можно открыть оба варианта. Это окно останется открытым после выбора."
        open={phase === "PRINT_OPTIONS"}
        onOpenChange={(nextOpen) => !nextOpen && close()}
        contentClassName="order-completion-flow order-completion-flow--print-options"
      >
        <div className="order-completion-flow__actions order-completion-flow__actions--print">
          <AppButton
            type="button"
            variant="secondary"
            onClick={() => void openInvoice(order, false)}
          >
            Без комментария
          </AppButton>
          <AppButton type="button" onClick={() => void openInvoice(order, true)}>
            С комментарием
          </AppButton>
          <AppButton type="button" variant="ghost" onClick={close}>
            Закрыть
          </AppButton>
        </div>
      </AppModal>
    </>
  );
}
