package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.entity.Warehouse;
import kz.company.shop.warehouse.repository.StockMovementRepository;
import kz.company.shop.warehouse.repository.WarehouseRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/** Exercises the real ledger and price chronology with isolated, rolled-back fixtures. */
@SpringBootTest
@Transactional
class WarehouseBackdatedPostingIntegrationTest {
    private static final LocalDate DATE = LocalDate.of(2020, 9, 24);
    private static final ZoneId ALMATY = ZoneId.of("Asia/Almaty");

    @Autowired private WarehouseService service;
    @Autowired private ProductRepository products;
    @Autowired private UserRepository users;
    @Autowired private WarehouseRepository warehouses;
    @Autowired private StockMovementRepository movements;
    @Autowired private EntityManager entityManager;

    private Long warehouseId;
    private CurrentUser actor;

    @BeforeEach
    void createIsolatedFixtures() {
        Warehouse warehouse = new Warehouse();
        warehouse.code = "IT-" + UUID.randomUUID();
        warehouse.nameRu = "Склад интеграционного теста";
        warehouseId = warehouses.saveAndFlush(warehouse).id;

        User user = new User();
        user.name = "Warehouse integration test";
        user.email = UUID.randomUUID() + "@example.test";
        user.passwordHash = "not-a-login-password";
        users.saveAndFlush(user);
        actor = new CurrentUser(user.id, user.email, user.name, null,
                Set.of(), true, BigDecimal.ZERO);
    }

    @Test
    void backdatedReceiptsAndRepostingKeepInventoryAtItsRecordedFact() {
        Product pipe209 = product("209");
        Product pipe2352 = product("2352");
        Product pipe214 = product("214");

        var firstReceipt = post(StockDocumentType.RECEIPT, "09:58", List.of(
                line(pipe209, "40"), line(pipe2352, "36")));
        var inventory = post(StockDocumentType.INVENTORY, "11:07", List.of(
                line(pipe209, "92"), line(pipe2352, "36"), line(pipe214, "14.7")));
        // Posted later in real time, but must precede inventory in the ledger.
        var secondReceipt = post(StockDocumentType.RECEIPT, "10:02", List.of(
                line(pipe209, "2"), line(pipe214, "12")));
        reload();

        assertPostedAt(firstReceipt.id(), "09:58");
        assertPostedAt(secondReceipt.id(), "10:02");
        assertPostedAt(inventory.id(), "11:07");
        assertInventory(inventory.id(), pipe209.id, "92", "50");
        assertInventory(inventory.id(), pipe2352.id, "36", "0");
        assertInventory(inventory.id(), pipe214.id, "14.7", "2.7");

        service.cancel(firstReceipt.id(), actor, true);
        reload();
        assertInventory(inventory.id(), pipe209.id, "92", "90");
        assertInventory(inventory.id(), pipe2352.id, "36", "36");

        service.saveAndPost(firstReceipt.id(), request(StockDocumentType.RECEIPT, "09:58",
                List.of(line(pipe209, "50"), line(pipe2352, "30"))), actor, true);
        reload();
        assertPostedAt(firstReceipt.id(), "09:58");
        assertInventory(inventory.id(), pipe209.id, "92", "40");
        assertInventory(inventory.id(), pipe2352.id, "36", "6");
        assertInventory(inventory.id(), pipe214.id, "14.7", "2.7");
        // The cancelled posting and its reversal must not be counted a second time.
        assertThat(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                warehouseId, pipe209.id)).hasSize(3);
    }

    @Test
    void earlierPricePostedLaterCannotReplaceLatestAndCancellationRestoresPredecessor() {
        Product product = product("price");
        var latest = post(StockDocumentType.PRICE_SETTING, "11:07", List.of(price(product, "300")));
        var earlier = post(StockDocumentType.PRICE_SETTING, "09:58", List.of(price(product, "200")));
        reload();
        assertThat(products.findById(product.id).orElseThrow().price).isEqualByComparingTo("300");

        service.cancel(latest.id(), actor, true);
        reload();
        assertThat(products.findById(product.id).orElseThrow().price).isEqualByComparingTo("200");

        service.cancel(earlier.id(), actor, true);
        reload();
        assertThat(products.findById(product.id).orElseThrow().price).isEqualByComparingTo("100");
    }

    @Test
    void changedLineOrderSurvivesDatabaseReloadAndPosting() {
        Product first = product("first");
        Product second = product("second");
        Product third = product("third");
        var draft = service.createDraft(request(StockDocumentType.RECEIPT, "09:58",
                List.of(line(first, "1"), line(second, "2"), line(third, "3"))), actor, true);
        service.updateDraft(draft.id(), request(StockDocumentType.RECEIPT, "09:58",
                List.of(line(third, "3"), line(first, "1"), line(second, "2"))), actor, true);
        reload();
        assertThat(service.getDocument(draft.id(), true).lines())
                .extracting(WarehouseDto.DocumentLine::productId)
                .containsExactly(third.id, first.id, second.id);

        service.post(draft.id(), actor, true);
        reload();
        assertThat(service.getDocument(draft.id(), true).lines())
                .extracting(WarehouseDto.DocumentLine::productId)
                .containsExactly(third.id, first.id, second.id);
    }

    private Product product(String suffix) {
        Product product = new Product();
        product.sku = "IT-" + suffix + "-" + UUID.randomUUID();
        product.nameRu = "Тестовый товар " + suffix;
        product.nameKk = product.nameRu;
        product.price = new BigDecimal("100");
        return products.saveAndFlush(product);
    }

    private WarehouseDto.Document post(StockDocumentType type, String time,
            List<WarehouseDto.DocumentLineRequest> lines) {
        var document = service.createDraft(request(type, time, lines), actor, true);
        return service.post(document.id(), actor, true);
    }

    private WarehouseDto.DocumentRequest request(StockDocumentType type, String time,
            List<WarehouseDto.DocumentLineRequest> lines) {
        return new WarehouseDto.DocumentRequest(type,
                type == StockDocumentType.PRICE_SETTING ? StockDocumentPriceType.RETAIL : null,
                warehouseId, null, null, null, DATE, LocalTime.parse(time), lines,
                null, null, null, null, null, null, List.of(), null);
    }

    private WarehouseDto.DocumentLineRequest line(Product product, String quantity) {
        return new WarehouseDto.DocumentLineRequest(product.id, new BigDecimal(quantity),
                new BigDecimal("10"), null, null, null, null);
    }

    private WarehouseDto.DocumentLineRequest price(Product product, String value) {
        return new WarehouseDto.DocumentLineRequest(product.id, BigDecimal.ONE,
                null, null, null, new BigDecimal(value), null);
    }

    private void assertPostedAt(UUID documentId, String time) {
        var document = service.getDocument(documentId, true);
        assertThat(document.status()).isEqualTo(StockDocumentStatus.POSTED);
        assertThat(document.effectiveDate()).isEqualTo(DATE);
        assertThat(document.effectiveTime()).isEqualTo(LocalTime.parse(time));
        assertThat(movements.findByDocumentId(documentId).stream()
                .filter(movement -> movement.reversesMovementId == null))
                .allSatisfy(movement -> assertThat(movement.occurredAt)
                        .isEqualTo(DATE.atTime(LocalTime.parse(time)).atZone(ALMATY).toInstant()));
    }

    private void assertInventory(UUID documentId, Long productId, String fact, String adjustment) {
        assertThat(movements.findByDocumentId(documentId).stream()
                .filter(movement -> movement.productId.equals(productId)))
                .singleElement().satisfies(movement -> {
                    assertThat(movement.inventoryQuantity).isEqualByComparingTo(fact);
                    assertThat(movement.quantity).isEqualByComparingTo(adjustment);
                });
        assertThat(movements.balanceByProductId(warehouseId, productId)).isEqualByComparingTo(fact);
    }

    private void reload() {
        entityManager.flush();
        entityManager.clear();
    }
}
