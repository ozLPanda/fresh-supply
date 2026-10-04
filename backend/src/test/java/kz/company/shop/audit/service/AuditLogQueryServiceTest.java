package kz.company.shop.audit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import kz.company.shop.audit.entity.AuditLog;
import kz.company.shop.audit.repository.AuditLogRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

class AuditLogQueryServiceTest {
    @Test
    void returnsNewestAuditEventsUsingBoundedPagination() {
        AuditLogRepository repository = mock(AuditLogRepository.class);
        AuditLogQueryService service = new AuditLogQueryService(repository);
        AuditLog log = new AuditLog();
        log.id = 15L;
        log.actorUserId = 7L;
        log.actorName = "Администратор";
        log.action = "UPDATE";
        log.entityType = "PRODUCT";
        log.entityId = "25";
        log.description = "Изменил товар";
        log.createdAt = Instant.parse("2026-08-20T07:00:00Z");
        when(repository.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(log), Pageable.ofSize(100), 101));

        var result = service.list("товар", null, null, 0, 200);

        assertThat(result.items())
                .singleElement()
                .satisfies(
                        item -> {
                            assertThat(item.id()).isEqualTo(15L);
                            assertThat(item.actorUserId()).isEqualTo(7L);
                            assertThat(item.description()).isEqualTo("Изменил товар");
                        });
        assertThat(result.page()).isEqualTo(1);
        assertThat(result.size()).isEqualTo(100);
        assertThat(result.totalItems()).isEqualTo(101);

        var pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).findAll(any(Specification.class), pageable.capture());
        assertThat(pageable.getValue().getPageNumber()).isZero();
        assertThat(pageable.getValue().getPageSize()).isEqualTo(100);
        assertThat(pageable.getValue().getSort().getOrderFor("createdAt")).isNotNull();
    }

    @Test
    void rejectsReverseDateRange() {
        AuditLogRepository repository = mock(AuditLogRepository.class);
        AuditLogQueryService service = new AuditLogQueryService(repository);

        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () ->
                                service.list(
                                        null,
                                        LocalDate.of(2026, 8, 21),
                                        LocalDate.of(2026, 8, 20),
                                        1,
                                        25))
                .isInstanceOf(kz.company.shop.common.exception.AppExceptions.BadRequest.class)
                .hasMessage("Дата начала не может быть позже даты окончания");
    }
}
