package kz.company.shop.regularbuyers.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.regularbuyers.RegularBuyerAliases;
import kz.company.shop.regularbuyers.dto.RegularBuyerDto;
import kz.company.shop.regularbuyers.dto.RegularBuyerRequest;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import kz.company.shop.regularbuyers.repository.RegularBuyerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RegularBuyerService {
    private final RegularBuyerRepository repository;

    public RegularBuyerService(RegularBuyerRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<RegularBuyerDto> list(boolean includeArchived) {
        return (includeArchived
                        ? repository.findAllByOrderByNameAsc()
                        : repository.findByArchivedFalseOrderByNameAsc())
                .stream().map(this::toDto).toList();
    }

    @Transactional
    public RegularBuyerDto create(RegularBuyerRequest request) {
        RegularBuyer buyer = new RegularBuyer();
        buyer.id = UUID.randomUUID();
        apply(buyer, request);
        return toDto(repository.save(buyer));
    }

    @Transactional
    public RegularBuyerDto update(UUID id, RegularBuyerRequest request) {
        RegularBuyer buyer = get(id);
        apply(buyer, request);
        return toDto(repository.save(buyer));
    }

    /** Existing bindings retain their historical name even after directory edits or archiving. */
    public void assign(Order order, UUID regularBuyerId) {
        if (regularBuyerId == null) {
            order.regularBuyerId = null;
            order.regularBuyerName = null;
            return;
        }
        if (regularBuyerId.equals(order.regularBuyerId)) return;
        RegularBuyer buyer = get(regularBuyerId);
        if (buyer.archived)
            throw new AppExceptions.BadRequest("Выбранный постоянный покупатель в архиве");
        order.regularBuyerId = buyer.id;
        order.regularBuyerName = buyer.name;
    }

    private RegularBuyer get(UUID id) {
        return repository
                .findById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Постоянный покупатель не найден"));
    }

    /** Use the order's name snapshot with current requisites, including for archived buyers. */
    @Transactional(readOnly = true)
    public String paymentInvoiceBuyerDetails(UUID buyerId, String orderBuyerName) {
        String name = normalized(orderBuyerName);
        RegularBuyer buyer = buyerId == null ? null : repository.findById(buyerId).orElse(null);
        List<String> parts = new ArrayList<>();
        String taxId = buyer == null ? null : normalized(buyer.taxId);
        String address = buyer == null ? null : normalized(buyer.legalAddress);
        if (taxId != null) parts.add("ИИН/БИН: " + taxId);
        if (name != null) parts.add(name);
        if (address != null) parts.add(address);
        return String.join(", ", parts);
    }

    private void apply(RegularBuyer buyer, RegularBuyerRequest request) {
        String name = normalized(request.name());
        if (name == null)
            throw new AppExceptions.BadRequest("Укажите наименование постоянного покупателя");
        List<String> aliases =
                request.aliases() == null ? null : RegularBuyerAliases.normalize(request.aliases());
        if (aliases != null) {
            buyer.aliases.clear();
            buyer.aliases.addAll(aliases);
        }
        buyer.name = name;
        buyer.contactName = normalized(request.contactName());
        buyer.phone = normalized(request.phone());
        buyer.email = normalized(request.email());
        buyer.taxId = normalized(request.taxId());
        buyer.legalAddress = normalized(request.legalAddress());
        buyer.comment = normalized(request.comment());
        buyer.archived = request.archived();
        buyer.updatedAt = Instant.now();
    }

    private String normalized(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private RegularBuyerDto toDto(RegularBuyer buyer) {
        return new RegularBuyerDto(
                buyer.id,
                buyer.name,
                buyer.contactName,
                buyer.phone,
                buyer.email,
                buyer.comment,
                buyer.archived,
                buyer.createdAt,
                buyer.updatedAt,
                buyer.taxId,
                buyer.legalAddress,
                buyer.aliases);
    }
}
