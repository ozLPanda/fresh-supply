package kz.company.shop.regularbuyers.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.*;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import kz.company.shop.regularbuyers.repository.RegularBuyerRepository;
import kz.company.shop.regularbuyers.service.RegularBuyerAliasLearningService.Status;
import org.junit.jupiter.api.Test;

class RegularBuyerAliasLearningServiceTest {
    final RegularBuyerRepository repository = mock(RegularBuyerRepository.class);
    final EntityManager entityManager = mock(EntityManager.class);
    final RegularBuyerAliasLearningService service =
            new RegularBuyerAliasLearningService(repository, entityManager);

    RegularBuyer buyer(String name, String... aliases) {
        RegularBuyer buyer = new RegularBuyer();
        buyer.id = UUID.randomUUID();
        buyer.name = name;
        buyer.aliases.addAll(List.of(aliases));
        return buyer;
    }

    @Test
    void appendsWithoutReplacingExistingAliasesOrOfficialDetails() {
        RegularBuyer buyer = buyer("ИП Основное название", "Викинг", "Кухня");
        buyer.contactName = "Контакт";
        buyer.updatedAt = Instant.EPOCH;
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(buyer));
        var result = service.append(buyer.id, "  Север\\tГараж  ".replace("\\t", "\t"));
        assertThat(result.status()).isEqualTo(Status.ADDED);
        assertThat(result.officialName()).isEqualTo("ИП Основное название");
        assertThat(buyer.aliases).containsExactly("Викинг", "Кухня", "Север Гараж");
        assertThat(buyer.name).isEqualTo("ИП Основное название");
        assertThat(buyer.contactName).isEqualTo("Контакт");
        assertThat(buyer.updatedAt).isAfter(Instant.EPOCH);
        verify(repository).save(buyer);
        verify(repository, never()).findForUpdateById(any());
    }

    @Test
    void repeatedCaseAndYoEquivalentApprovalDoesNotDuplicateOrWrite() {
        RegularBuyer buyer = buyer("ИП Получатель", "Ёлка");
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(buyer));
        assertThat(service.append(buyer.id, "  ЕЛКА  ").status()).isEqualTo(Status.ALREADY_PRESENT);
        assertThat(service.append(buyer.id, "ИП   Получатель").status())
                .isEqualTo(Status.ALREADY_PRESENT);
        assertThat(buyer.aliases).containsExactly("Ёлка");
        verify(repository, never()).save(any());
    }

    @Test
    void repeatedSuccessfulCallIsIdempotent() {
        RegularBuyer buyer = buyer("Получатель");
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(buyer));
        assertThat(service.append(buyer.id, "Викинг").status()).isEqualTo(Status.ADDED);
        assertThat(service.append(buyer.id, "викинг").status()).isEqualTo(Status.ALREADY_PRESENT);
        assertThat(buyer.aliases).containsExactly("Викинг");
        verify(repository, times(1)).save(buyer);
    }

    @Test
    void otherActiveOfficialNameAndAliasesAreConflicts() {
        RegularBuyer target = buyer("Получатель", "Сохранённая метка");
        RegularBuyer other = buyer("Ёлка", "Викинг", "Сохранённая метка");
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(target, other));
        for (String alias : List.of("  ЕЛКА  ", "викинг", "Сохранённая метка")) {
            var result = service.append(target.id, alias);
            assertThat(result.status()).isEqualTo(Status.CONFLICT);
            assertThat(result.officialName()).isEqualTo(target.name);
        }
        assertThat(target.aliases).containsExactly("Сохранённая метка");
        verify(repository, never()).save(any());
    }

    @Test
    void archivedBuyerIsNotChangedAndMissingBuyerIsReportedAfterDirectoryLock() {
        RegularBuyer active = buyer("Активный");
        RegularBuyer archived = buyer("Архивный", "Старое");
        archived.archived = true;
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(active));
        when(repository.findForUpdateById(archived.id)).thenReturn(Optional.of(archived));
        assertThat(service.append(archived.id, "Новое").status()).isEqualTo(Status.ARCHIVED);
        var sequence = inOrder(repository);
        sequence.verify(repository).findActiveForUpdateOrdered();
        sequence.verify(repository).findForUpdateById(archived.id);
        assertThat(service.append(UUID.randomUUID(), "Новое").status()).isEqualTo(Status.NOT_FOUND);
        assertThat(archived.aliases).containsExactly("Старое");
        verify(repository, never()).save(any());
    }

    @Test
    void limitDoesNotBlockExistingAliasAndNeverEvictsOldAliases() {
        RegularBuyer target = buyer("Получатель");
        for (int i = 0; i < 50; i++) target.aliases.add("Метка " + i);
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(target));
        assertThat(service.append(target.id, "Новое").status()).isEqualTo(Status.LIMIT_REACHED);
        assertThat(service.append(target.id, "Метка 1").status()).isEqualTo(Status.ALREADY_PRESENT);
        assertThat(target.aliases).hasSize(50).contains("Метка 0", "Метка 49");
        verify(repository, never()).save(any());
    }

    @Test
    void invalidInputReturnsBusinessStatusWithoutLockOrWrite() {
        for (String alias : Arrays.asList(null, "", " \t\n\u00a0 ", "x".repeat(121))) {
            assertThat(service.append(UUID.randomUUID(), alias).status()).isEqualTo(Status.INVALID);
        }
        assertThat(service.append(null, "Гараж").status()).isEqualTo(Status.INVALID);
        verifyNoInteractions(repository);
    }

    @Test
    void normalizationPrecedesLimitAndAllowsFiftiethAlias() {
        RegularBuyer target = buyer("Получатель");
        for (int i = 0; i < 49; i++) target.aliases.add("Метка " + i);
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(target));
        assertThat(service.append(target.id, "  " + "x".repeat(120) + "  ").status())
                .isEqualTo(Status.ADDED);
        assertThat(target.aliases).hasSize(50).endsWith("x".repeat(120));
    }

    @Test
    void refreshAfterLockPreservesAliasAddedDuringSlowOuterConversation() {
        RegularBuyer target = buyer("Получатель", "Ранее загруженная метка");
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(target));
        doAnswer(
                        call -> {
                            target.aliases.add("Добавлено другим диалогом");
                            return null;
                        })
                .when(entityManager)
                .refresh(target);
        assertThat(service.append(target.id, "Новая метка").status()).isEqualTo(Status.ADDED);
        assertThat(target.aliases)
                .containsExactly(
                        "Ранее загруженная метка", "Добавлено другим диалогом", "Новая метка");
        var sequence = inOrder(repository, entityManager);
        sequence.verify(repository).findActiveForUpdateOrdered();
        sequence.verify(entityManager).refresh(target);
        sequence.verify(repository).save(target);
    }

    @Test
    void refreshingOtherLockedBuyersDetectsNewConflict() {
        RegularBuyer target = buyer("Получатель");
        RegularBuyer other = buyer("Другой покупатель");
        when(repository.findActiveForUpdateOrdered()).thenReturn(List.of(target, other));
        doAnswer(
                        call -> {
                            other.aliases.add("Викинг");
                            return null;
                        })
                .when(entityManager)
                .refresh(other);
        assertThat(service.append(target.id, "Викинг").status()).isEqualTo(Status.CONFLICT);
        assertThat(target.aliases).isEmpty();
        verify(entityManager).refresh(target);
        verify(entityManager).refresh(other);
        verify(repository, never()).save(any());
    }
}
