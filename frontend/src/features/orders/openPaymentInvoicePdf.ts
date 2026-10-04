import { API_URL } from "@/shared/api/http";
import { appToast } from "@/shared/ui/AppToast";

export async function openPaymentInvoicePdf(orderId: string) {
  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) {
    appToast.error("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
    return;
  }

  previewWindow.document.title = "Загрузка счёта на оплату…";
  previewWindow.document.body.textContent = "Формируем счёт на оплату…";

  try {
    const response = await fetch(
      `${API_URL}/api/admin/orders/${encodeURIComponent(orderId)}/payment-invoice.pdf`,
      { credentials: "include" },
    );
    if (!response.ok) {
      let message = "Не удалось сформировать счёт на оплату";
      try {
        const error = (await response.json()) as { message?: string };
        if (error.message) message = error.message;
      } catch {
        // A proxy can return an HTML error page instead of the API response.
      }
      throw new Error(message);
    }

    const pdfUrl = URL.createObjectURL(await response.blob());
    previewWindow.location.replace(pdfUrl);
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 30 * 60 * 1_000);
  } catch (error) {
    previewWindow.close();
    appToast.error(error instanceof Error ? error.message : "Не удалось открыть счёт на оплату");
  }
}
