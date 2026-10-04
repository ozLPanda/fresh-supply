package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.warehouse.entity.PriceSettingGroup;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockDocumentLine;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.repository.PriceSettingGroupRepository;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentRepository;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class PriceSettingGroupPdfServiceTest {
    @Test
    void exportsAiDraftBeforeWarehouseDocumentsExist() throws Exception {
        PriceSettingGroupPdfService service = new PriceSettingGroupPdfService(
                mock(PriceSettingGroupRepository.class), mock(StockDocumentRepository.class),
                mock(StockDocumentLineRepository.class), mock(ProductRepository.class));
        byte[] pdf = service.generatePreview("Тест 123", List.of(
                new PriceSettingGroupPdfService.PreviewRow("T-101", "Труба стальная",
                        Map.of(StockDocumentPriceType.RETAIL, new BigDecimal("180")),
                        Map.of(StockDocumentPriceType.RETAIL, new BigDecimal("100")))));

        try (PDDocument rendered = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(rendered);
            assertThat(text).contains("Тест 123", "Труба стальная", "180", "100", "+80%");
        }
    }

    @Test
    void exportsDraftPricesAndPrefersThemToPostedValues() throws Exception {
        PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        PriceSettingGroupPdfService service =
                new PriceSettingGroupPdfService(groups, documents, lines, products);
        UUID groupId = UUID.randomUUID();
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = groupId;
        group.name = "Тест 123";
        Product product = new Product();
        product.id = 101L;
        product.sku = "T-101";
        product.nameRu = "Труба стальная";
        product.price = new BigDecimal("100.00");
        product.wholesalePrice = new BigDecimal("90.00");
        product.bulkWholesalePrice = new BigDecimal("80.00");
        product.skoPrice = new BigDecimal("70.00");
        product.gskoPrice = new BigDecimal("60.00");
        product.incomingPrice = new BigDecimal("50.00");
        when(groups.findById(groupId)).thenReturn(Optional.of(group));
        when(products.findByIdAndDeletedAtIsNull(product.id)).thenReturn(Optional.of(product));

        List<StockDocument> allDocuments = new ArrayList<>();
        for (StockDocumentPriceType type : StockDocumentPriceType.values()) {
            StockDocument draft = new StockDocument();
            draft.id = UUID.randomUUID();
            draft.documentType = StockDocumentType.PRICE_SETTING;
            draft.status = StockDocumentStatus.DRAFT;
            draft.priceSettingGroupId = groupId;
            draft.priceType = type;
            allDocuments.add(draft);
            StockDocumentLine line = new StockDocumentLine();
            line.documentId = draft.id;
            line.productId = product.id;
            line.unitPrice = type == StockDocumentPriceType.RETAIL
                    ? new BigDecimal("120.00") : new BigDecimal("110.00");
            when(lines.findByDocumentIdOrderById(draft.id)).thenReturn(List.of(line));
        }
        StockDocument previous = new StockDocument();
        previous.id = UUID.randomUUID();
        previous.documentType = StockDocumentType.PRICE_SETTING;
        previous.status = StockDocumentStatus.POSTED;
        previous.priceSettingGroupId = groupId;
        previous.priceType = StockDocumentPriceType.RETAIL;
        previous.postedAt = Instant.now().plusSeconds(3600);
        allDocuments.add(previous);
        StockDocumentLine previousLine = new StockDocumentLine();
        previousLine.documentId = previous.id;
        previousLine.productId = product.id;
        previousLine.unitPrice = new BigDecimal("9999.00");
        previousLine.previousUnitPrice = new BigDecimal("50.00");
        when(lines.findByDocumentIdOrderById(previous.id)).thenReturn(List.of(previousLine));
        when(documents.findByPriceSettingGroupIdAndDeletedAtIsNullOrderByCreatedAtDesc(groupId))
                .thenReturn(allDocuments);

        byte[] pdf = service.generate(groupId);
        try (PDDocument rendered = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(rendered);
            assertThat(rendered.getNumberOfPages()).isGreaterThanOrEqualTo(1);
            assertThat(text).contains("Тест 123", "Труба стальная", "120", "100");
            assertThat(text).doesNotContain("9999");
        }
    }
}
