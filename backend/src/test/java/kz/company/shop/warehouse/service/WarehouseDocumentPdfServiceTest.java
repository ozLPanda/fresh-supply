package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.StockDocumentType;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class WarehouseDocumentPdfServiceTest {
    private final WarehouseService warehouse = mock(WarehouseService.class);
    private final WarehouseDocumentPdfService service = new WarehouseDocumentPdfService(warehouse);

    @Test
    void exportsRequiredColumnsForBothDocumentTypesWithoutPrices() throws Exception {
        for (StockDocumentType type :
                List.of(StockDocumentType.PURCHASE_ORDER, StockDocumentType.RECEIPT)) {
            UUID id = UUID.randomUUID();
            when(warehouse.getDocument(id, false))
                    .thenReturn(
                            document(
                                    id,
                                    type,
                                    List.of(line("ABC-1", "Насос циркуляционный", "2.5"))));

            try (PDDocument pdf = Loader.loadPDF(service.generate(id))) {
                String text = new PDFTextStripper().getText(pdf).replace('\u00a0', ' ');
                assertThat(text)
                        .contains(
                                type == StockDocumentType.PURCHASE_ORDER ? "Заказ" : "Приход",
                                "Артикул",
                                "Номенклатура",
                                "Кол-во",
                                "ABC-1",
                                "Насос циркуляционный",
                                "2,5");
                assertThat(text)
                        .doesNotContain("Цена", "Стоимость", "Контрагент", "Поставщик", "№ 123");
            }
            verify(warehouse).getDocument(id, false);
        }
    }

    @Test
    void repeatsTableHeaderOnEveryPage() throws Exception {
        UUID id = UUID.randomUUID();
        List<WarehouseDto.DocumentLine> lines =
                IntStream.range(0, 80)
                        .mapToObj(
                                index ->
                                        line(
                                                "SKU-" + index,
                                                "Длинное название товара для проверки переноса строки "
                                                        + index,
                                                "1"))
                        .toList();
        when(warehouse.getDocument(id, false))
                .thenReturn(document(id, StockDocumentType.RECEIPT, lines));

        try (PDDocument pdf = Loader.loadPDF(service.generate(id))) {
            assertThat(pdf.getNumberOfPages()).isGreaterThan(1);
            PDFTextStripper secondPage = new PDFTextStripper();
            secondPage.setStartPage(2);
            secondPage.setEndPage(2);
            assertThat(secondPage.getText(pdf))
                    .contains("Артикул", "Номенклатура", "Кол-во", "Страница 2");
        }
    }

    @Test
    void rejectsUnrelatedDocumentTypes() {
        UUID id = UUID.randomUUID();
        when(warehouse.getDocument(id, false))
                .thenReturn(document(id, StockDocumentType.INVENTORY, List.of()));
        assertThatThrownBy(() -> service.generate(id)).isInstanceOf(AppExceptions.BadRequest.class);
    }

    private WarehouseDto.DocumentLine line(String sku, String name, String quantity) {
        return new WarehouseDto.DocumentLine(
                1L,
                1L,
                sku,
                name,
                new BigDecimal(quantity),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                false,
                null);
    }

    private WarehouseDto.Document document(
            UUID id, StockDocumentType type, List<WarehouseDto.DocumentLine> lines) {
        return new WarehouseDto.Document(
                id,
                "123",
                type,
                null,
                null,
                1L,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                lines,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                "Поставщик");
    }
}
