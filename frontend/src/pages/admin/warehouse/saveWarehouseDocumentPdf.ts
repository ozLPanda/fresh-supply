import { downloadWarehouseDocumentPdf, type WarehouseDocument } from "@/shared/api/warehouse";

type PdfDocument = Pick<WarehouseDocument, "id" | "type" | "documentNumber">;

export async function saveWarehouseDocumentPdf(document: PdfDocument) {
  const blob = await downloadWarehouseDocumentPdf(document.id);
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement("a");
  const number = (document.documentNumber ?? document.id).replace(/[^\p{L}\p{N}._-]+/gu, "-");
  link.href = url;
  link.download = `${document.type === "PURCHASE_ORDER" ? "zakaz-postavshchiku" : "prikhod"}-${number}.pdf`;
  globalThis.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
