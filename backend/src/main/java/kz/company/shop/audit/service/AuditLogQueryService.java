package kz.company.shop.audit.service;

import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import kz.company.shop.audit.dto.AuditLogDto;
import kz.company.shop.audit.entity.AuditLog;
import kz.company.shop.audit.repository.AuditLogRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditLogQueryService {
    private static final int MAX_PAGE_SIZE = 100;
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Qyzylorda");

    private final AuditLogRepository repository;

    public AuditLogQueryService(AuditLogRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public PageResult<AuditLogDto> list(
            String search, LocalDate from, LocalDate to, int page, int size) {
        if (from != null && to != null && from.isAfter(to)) {
            throw new AppExceptions.BadRequest("Дата начала не может быть позже даты окончания");
        }
        PageRequest pageable =
                PageRequest.of(
                        Math.max(page, 1) - 1,
                        Math.min(Math.max(size, 1), MAX_PAGE_SIZE),
                        Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")));
        Page<AuditLog> result = repository.findAll(searchSpecification(search, from, to), pageable);
        return new PageResult<>(
                result.getContent().stream().map(this::toDto).toList(),
                result.getNumber() + 1,
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    private Specification<AuditLog> searchSpecification(
            String search, LocalDate from, LocalDate to) {
        var searchVariants = ProductSearchTextNormalizer.rawSearchVariants(search);
        return (root, query, criteriaBuilder) -> {
            var predicates = new ArrayList<Predicate>();
            if (!searchVariants.isEmpty()) {
                Expression<String> actorName = criteriaBuilder.lower(root.<String>get("actorName"));
                Expression<String> action = criteriaBuilder.lower(root.<String>get("action"));
                Expression<String> entityType =
                        criteriaBuilder.lower(root.<String>get("entityType"));
                Expression<String> entityId = criteriaBuilder.lower(root.<String>get("entityId"));
                Expression<String> description =
                        criteriaBuilder.lower(root.<String>get("description"));
                var matches = new ArrayList<Predicate>();
                for (String variant : searchVariants) {
                    String pattern = "%" + variant + "%";
                    matches.add(
                            criteriaBuilder.or(
                                    criteriaBuilder.like(actorName, pattern),
                                    criteriaBuilder.like(action, pattern),
                                    criteriaBuilder.like(entityType, pattern),
                                    criteriaBuilder.like(entityId, pattern),
                                    criteriaBuilder.like(description, pattern)));
                }
                predicates.add(criteriaBuilder.or(matches.toArray(Predicate[]::new)));
            }
            if (from != null) {
                Instant fromInstant = from.atStartOfDay(BUSINESS_ZONE).toInstant();
                predicates.add(
                        criteriaBuilder.greaterThanOrEqualTo(root.get("createdAt"), fromInstant));
            }
            if (to != null) {
                Instant toExclusive = to.plusDays(1).atStartOfDay(BUSINESS_ZONE).toInstant();
                predicates.add(criteriaBuilder.lessThan(root.get("createdAt"), toExclusive));
            }
            return predicates.isEmpty()
                    ? criteriaBuilder.conjunction()
                    : criteriaBuilder.and(predicates.toArray(Predicate[]::new));
        };
    }

    private AuditLogDto toDto(AuditLog log) {
        return new AuditLogDto(
                log.id,
                log.actorUserId,
                log.actorName,
                log.action,
                log.entityType,
                log.entityId,
                log.description,
                log.createdAt);
    }
}
