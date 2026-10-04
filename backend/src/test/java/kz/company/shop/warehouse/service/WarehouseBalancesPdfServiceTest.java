package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.warehouse.dto.WarehouseDto;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class WarehouseBalancesPdfServiceTest {
    private final WarehouseService warehouse = mock(WarehouseService.class);
    private final WarehouseBalancesPdfService service = new WarehouseBalancesPdfService(warehouse);

    @Test
    void standardExportUsesSearchAndStockFilterAndHasRequiredColumns() throws Exception {
        when(warehouse.balances(false))
                .thenReturn(
                        List.of(
                                balance("P-1", "Насос циркуляционный", "8", "2", "6"),
                                balance("P-2", "Клапан", "12", "0", "12")));

        byte[] pdf =
                service.generate(
                        WarehouseBalancesPdfService.Mode.STANDARD,
                        WarehouseBalancesPdfService.StockFilter.BELOW_10,
                        "насос p-1");

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(document.getPage(0).getMediaBox().getWidth())
                    .isGreaterThan(document.getPage(0).getMediaBox().getHeight());
            assertThat(text)
                    .contains(
                            "Остатки на складе",
                            "Артикул",
                            "Товар",
                            "Остаток",
                            "Резерв",
                            "Доступно",
                            "P-1",
                            "Насос циркуляционный",
                            "8",
                            "2",
                            "6",
                            "Страница 1")
                    .doesNotContain("P-2", "Фактический остаток");
        }
        verify(warehouse).balances(false);
    }

    @Test
    void inventoryExportAddsBlankActualBalanceColumnAndKeepsNegativeBelowThreshold() throws Exception {
        when(warehouse.balances(false))
                .thenReturn(List.of(balance("NEG-1", "Товар с отрицательным остатком", "-3", "0", "-3")));

        byte[] pdf =
                service.generate(
                        WarehouseBalancesPdfService.Mode.INVENTORY,
                        WarehouseBalancesPdfService.StockFilter.BELOW_10,
                        null);

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(text)
                    .contains(
                            "Инвентаризационная ведомость",
                            "Фактический",
                            "остаток",
                            "NEG-1",
                            "Товар с отрицательным остатком",
                            "-3");
        }
    }

    @Test
    void stockFiltersFollowOnHandSemantics() {
        assertThat(WarehouseBalancesPdfService.StockFilter.ZERO.matches(BigDecimal.ZERO)).isTrue();
        assertThat(WarehouseBalancesPdfService.StockFilter.ZERO.matches(new BigDecimal("-1"))).isFalse();
        assertThat(WarehouseBalancesPdfService.StockFilter.BELOW_ZERO.matches(new BigDecimal("-1")))
                .isTrue();
        assertThat(WarehouseBalancesPdfService.StockFilter.BELOW_ZERO.matches(BigDecimal.ZERO))
                .isFalse();
        assertThat(WarehouseBalancesPdfService.StockFilter.IN_STOCK.matches(BigDecimal.ONE)).isTrue();
        assertThat(WarehouseBalancesPdfService.StockFilter.IN_STOCK.matches(BigDecimal.ZERO)).isFalse();
        assertThat(WarehouseBalancesPdfService.StockFilter.BELOW_10.matches(new BigDecimal("-1"))).isTrue();
        assertThat(WarehouseBalancesPdfService.StockFilter.BELOW_100.matches(new BigDecimal("99.999")))
                .isTrue();
    }

    @Test
    void repeatsTableHeaderAndPageNumberOnAdditionalPages() throws Exception {
        List<WarehouseDto.Balance> balances =
                java.util.stream.IntStream.range(0, 70)
                        .mapToObj(
                                index ->
                                        balance(
                                                "P-" + index,
                                                "Длинное наименование товара для проверки постраничной таблицы "
                                                        + index,
                                                "1",
                                                "0",
                                                "1"))
                        .toList();
        when(warehouse.balances(false)).thenReturn(balances);

        byte[] pdf =
                service.generate(
                        WarehouseBalancesPdfService.Mode.STANDARD,
                        WarehouseBalancesPdfService.StockFilter.ALL,
                        null);

        try (PDDocument document = Loader.loadPDF(pdf)) {
            PDFTextStripper secondPage = new PDFTextStripper();
            secondPage.setStartPage(2);
            secondPage.setEndPage(2);

            assertThat(document.getNumberOfPages()).isGreaterThan(1);
            assertThat(secondPage.getText(document))
                    .contains("Остатки на складе", "Артикул", "Страница 2");
        }
    }

    private WarehouseDto.Balance balance(
            String sku, String name, String onHand, String reserved, String available) {
        return new WarehouseDto.Balance(
                1L,
                sku,
                name,
                new BigDecimal(onHand),
                new BigDecimal(reserved),
                new BigDecimal(available),
                null);
    }
}
