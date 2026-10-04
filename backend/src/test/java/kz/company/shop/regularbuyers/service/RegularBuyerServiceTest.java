package kz.company.shop.regularbuyers.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.regularbuyers.dto.RegularBuyerRequest;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import kz.company.shop.regularbuyers.repository.RegularBuyerRepository;
import org.junit.jupiter.api.Test;

class RegularBuyerServiceTest {
    private final RegularBuyerRepository repository = mock(RegularBuyerRepository.class);
    private final RegularBuyerService service = new RegularBuyerService(repository);

    @Test
    void createsAndUpdatesDirectoryWithoutChangingOrderSnapshot() {
        when(repository.save(any())).thenAnswer(call -> call.getArgument(0));
        var created = service.create(new RegularBuyerRequest("  ИП Получатель  ", "  Контакт  ",
                "  +77000000000  ", "buyer@example.com", "  Комментарий  ", false));
        assertThat(created.id()).isNotNull();
        assertThat(created.name()).isEqualTo("ИП Получатель");
        assertThat(created.contactName()).isEqualTo("Контакт");
        RegularBuyer buyer = buyer(created.id(), created.name(), false);
        when(repository.findById(buyer.id)).thenReturn(Optional.of(buyer));
        Order order = new Order();
        service.assign(order, buyer.id);
        var updated = service.update(buyer.id, new RegularBuyerRequest("ИП Новое имя", null,
                null, null, null, true));
        assertThat(updated.archived()).isTrue();
        assertThat(updated.name()).isEqualTo("ИП Новое имя");
        assertThat(order.regularBuyerName).isEqualTo("ИП Получатель");
        service.assign(order, buyer.id);
        assertThat(order.regularBuyerName).isEqualTo("ИП Получатель");
    }

    @Test
    void rejectsArchivedAndMissingNewBindingsAndAllowsClear() {
        UUID id = UUID.randomUUID();
        RegularBuyer buyer = buyer(id, "ИП Архив", true);
        when(repository.findById(id)).thenReturn(Optional.of(buyer));
        Order order = new Order();
        assertThatThrownBy(() -> service.assign(order, id)).isInstanceOf(AppExceptions.BadRequest.class);
        assertThat(order.regularBuyerId).isNull();
        assertThatThrownBy(() -> service.assign(order, UUID.randomUUID())).isInstanceOf(AppExceptions.NotFound.class);
        order.regularBuyerId = id;
        order.regularBuyerName = "Сохранённое имя";
        service.assign(order, id);
        assertThat(order.regularBuyerName).isEqualTo("Сохранённое имя");
        service.assign(order, null);
        assertThat(order.regularBuyerId).isNull();
        assertThat(order.regularBuyerName).isNull();
    }

    @Test
    void savesNormalizedOptionalPaymentDetailsAndAllowsClearing() {
        when(repository.save(any())).thenAnswer(call -> call.getArgument(0));
        var created = service.create(new RegularBuyerRequest("ИП Получатель", null, null, null,
                null, false, "  012345678901  ", "  г. Алматы, ул. Абая, 1  "));
        assertThat(created.taxId()).isEqualTo("012345678901");
        assertThat(created.legalAddress()).isEqualTo("г. Алматы, ул. Абая, 1");
        RegularBuyer buyer = buyer(created.id(), created.name(), false);
        buyer.taxId = created.taxId();
        buyer.legalAddress = created.legalAddress();
        when(repository.findById(buyer.id)).thenReturn(Optional.of(buyer));
        var updated = service.update(buyer.id, new RegularBuyerRequest("ИП Получатель", null,
                null, null, null, false, "  ", "  "));
        assertThat(updated.taxId()).isNull();
        assertThat(updated.legalAddress()).isNull();
    }

    @Test
    void paymentInvoiceUsesCurrentDetailsAndSnapshotNameEvenForArchivedBuyer() {
        RegularBuyer buyer = buyer(UUID.randomUUID(), "Новое имя в справочнике", true);
        buyer.taxId = "012345678901";
        buyer.legalAddress = "г. Алматы, ул. Абая, 1";
        when(repository.findById(buyer.id)).thenReturn(Optional.of(buyer));
        assertThat(service.paymentInvoiceBuyerDetails(buyer.id, "  Имя в заказе  "))
                .isEqualTo("ИИН/БИН: 012345678901, Имя в заказе, г. Алматы, ул. Абая, 1");
        buyer.legalAddress = "Новый адрес";
        assertThat(service.paymentInvoiceBuyerDetails(buyer.id, "Имя в заказе"))
                .endsWith(", Новый адрес");
    }

    @Test
    void paymentInvoiceOmitsEmptyPartsAndNeverSubstitutesDirectoryName() {
        RegularBuyer buyer = buyer(UUID.randomUUID(), "Не подставлять", false);
        when(repository.findById(buyer.id)).thenReturn(Optional.of(buyer));
        assertThat(service.paymentInvoiceBuyerDetails(buyer.id, "Имя в заказе")).isEqualTo("Имя в заказе");
        assertThat(service.paymentInvoiceBuyerDetails(buyer.id, null)).isEmpty();
        buyer.legalAddress = "  Адрес  ";
        buyer.taxId = "  ";
        assertThat(service.paymentInvoiceBuyerDetails(buyer.id, "  ")).isEqualTo("Адрес");
    }

    @Test
    void paymentInvoiceFallsBackToSnapshotForMissingOrUnassignedBuyer() {
        assertThat(service.paymentInvoiceBuyerDetails(null, "  Имя в заказе  ")).isEqualTo("Имя в заказе");
        assertThat(service.paymentInvoiceBuyerDetails(null, null)).isEmpty();
        verifyNoInteractions(repository);
        UUID missingId = UUID.randomUUID();
        when(repository.findById(missingId)).thenReturn(Optional.empty());
        assertThat(service.paymentInvoiceBuyerDetails(missingId, "Имя в заказе")).isEqualTo("Имя в заказе");
        assertThat(service.paymentInvoiceBuyerDetails(missingId, null)).isEmpty();
    }

    @Test
    void listsOnlyActiveByDefaultAndAllOnRequest() {
        RegularBuyer active = buyer(UUID.randomUUID(), "Активный", false);
        RegularBuyer archived = buyer(UUID.randomUUID(), "Архивный", true);
        when(repository.findByArchivedFalseOrderByNameAsc()).thenReturn(List.of(active));
        when(repository.findAllByOrderByNameAsc()).thenReturn(List.of(active, archived));
        assertThat(service.list(false)).extracting(item -> item.id()).containsExactly(active.id);
        assertThat(service.list(true)).hasSize(2);
    }

    private RegularBuyer buyer(UUID id, String name, boolean archived) {
        RegularBuyer buyer = new RegularBuyer();
        buyer.id = id;
        buyer.name = name;
        buyer.archived = archived;
        return buyer;
    }
}
