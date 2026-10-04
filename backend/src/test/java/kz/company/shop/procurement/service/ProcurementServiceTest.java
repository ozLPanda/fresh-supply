package kz.company.shop.procurement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.procurement.dto.ProcurementCompanyRequest;
import kz.company.shop.procurement.entity.ProcurementCompany;
import kz.company.shop.procurement.entity.ProcurementCompanyStatus;
import kz.company.shop.procurement.entity.ProcurementProject;
import kz.company.shop.procurement.repository.ProcurementCompanyLinkRepository;
import kz.company.shop.procurement.repository.ProcurementCompanyNoteRepository;
import kz.company.shop.procurement.repository.ProcurementCompanyRepository;
import kz.company.shop.procurement.repository.ProcurementFileRepository;
import kz.company.shop.procurement.repository.ProcurementPaymentRepository;
import kz.company.shop.procurement.repository.ProcurementProjectRepository;
import kz.company.shop.procurement.repository.ProcurementStatusHistoryRepository;
import org.junit.jupiter.api.Test;

class ProcurementServiceTest {
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void savesAndReturnsOptionalCompanyPrice() {
        ProcurementProjectRepository projects = mock(ProcurementProjectRepository.class);
        ProcurementCompanyRepository companies = mock(ProcurementCompanyRepository.class);
        ProcurementCompanyLinkRepository companyLinks =
                mock(ProcurementCompanyLinkRepository.class);
        when(projects.findById(7L)).thenReturn(Optional.of(new ProcurementProject()));
        when(companies.save(any(ProcurementCompany.class)))
                .thenAnswer(
                        invocation -> {
                            ProcurementCompany company = invocation.getArgument(0);
                            company.id = 17L;
                            return company;
                        });
        ProcurementService service = service(projects, companies, companyLinks);

        var result =
                service.addCompany(
                        7L,
                        new ProcurementCompanyRequest(
                                "Поставщик",
                                null,
                                null,
                                null,
                                null,
                                null,
                                List.of(),
                                new BigDecimal("1234.50"),
                                null,
                                null,
                                null));

        assertThat(result.price()).isEqualByComparingTo("1234.50");
        assertThat(result.priceCurrency()).isEqualTo("KZT");
        assertThat(result.name()).isEqualTo("Поставщик");
        assertThat(result.companyStatus()).isEqualTo(ProcurementCompanyStatus.FOUND);
        assertThat(result.decisionComment()).isNull();
    }

    @Test
    void normalizesCompanyPriceCurrencyAndClearsItWithoutPrice() {
        ProcurementProjectRepository projects = mock(ProcurementProjectRepository.class);
        ProcurementCompanyRepository companies = mock(ProcurementCompanyRepository.class);
        ProcurementCompanyLinkRepository companyLinks =
                mock(ProcurementCompanyLinkRepository.class);
        when(projects.findById(7L)).thenReturn(Optional.of(new ProcurementProject()));
        when(companies.save(any(ProcurementCompany.class)))
                .thenAnswer(
                        invocation -> {
                            ProcurementCompany company = invocation.getArgument(0);
                            company.id = 17L;
                            return company;
                        });
        ProcurementService service = service(projects, companies, companyLinks);

        var withCny = service.addCompany(7L, companyRequest(new BigDecimal("15.50"), " cny "));
        var withoutPrice = service.addCompany(7L, companyRequest(null, "USD"));

        assertThat(withCny.priceCurrency()).isEqualTo("CNY");
        assertThat(withoutPrice.price()).isNull();
        assertThat(withoutPrice.priceCurrency()).isNull();
    }

    @Test
    void acceptsMissingAndZeroCompanyPrice() {
        assertThat(validator.validate(companyRequest(null))).isEmpty();
        assertThat(validator.validate(companyRequest(BigDecimal.ZERO))).isEmpty();
    }

    @Test
    void rejectsCompanyPriceWithMoreThanTwoFractionDigits() {
        assertThat(validator.validate(companyRequest(new BigDecimal("12.345"))))
                .extracting(violation -> violation.getPropertyPath().toString())
                .contains("price");
    }

    @Test
    void rejectsCompanyPriceWithMoreThanTwoFractionDigitsWhenServiceIsUsedDirectly() {
        ProcurementProjectRepository projects = mock(ProcurementProjectRepository.class);
        when(projects.findById(7L)).thenReturn(Optional.of(new ProcurementProject()));
        ProcurementService service =
                service(
                        projects,
                        mock(ProcurementCompanyRepository.class),
                        mock(ProcurementCompanyLinkRepository.class));

        assertThatThrownBy(() -> service.addCompany(7L, companyRequest(new BigDecimal("12.345"))))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("Цена компании может содержать не более двух знаков после запятой");
    }

    @Test
    void rejectsNegativeCompanyPriceWhenServiceIsUsedDirectly() {
        assertThat(validator.validate(companyRequest(new BigDecimal("-0.01"))))
                .extracting(violation -> violation.getPropertyPath().toString())
                .contains("price");

        ProcurementProjectRepository projects = mock(ProcurementProjectRepository.class);
        when(projects.findById(7L)).thenReturn(Optional.of(new ProcurementProject()));
        ProcurementService service =
                service(
                        projects,
                        mock(ProcurementCompanyRepository.class),
                        mock(ProcurementCompanyLinkRepository.class));

        assertThatThrownBy(() -> service.addCompany(7L, companyRequest(new BigDecimal("-0.01"))))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("Цена компании не может быть отрицательной");
    }

    @Test
    void rejectsUnsupportedCompanyPriceCurrency() {
        ProcurementProjectRepository projects = mock(ProcurementProjectRepository.class);
        when(projects.findById(7L)).thenReturn(Optional.of(new ProcurementProject()));
        ProcurementService service =
                service(
                        projects,
                        mock(ProcurementCompanyRepository.class),
                        mock(ProcurementCompanyLinkRepository.class));

        assertThatThrownBy(
                        () -> service.addCompany(7L, companyRequest(new BigDecimal("1.00"), "EUR")))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("Валюта цены компании должна быть KZT, USD или CNY");
    }

    @Test
    void requiresDecisionCommentForRejectedCompany() {
        ProcurementProjectRepository projects = mock(ProcurementProjectRepository.class);
        when(projects.findById(7L)).thenReturn(Optional.of(new ProcurementProject()));
        ProcurementService service =
                service(
                        projects,
                        mock(ProcurementCompanyRepository.class),
                        mock(ProcurementCompanyLinkRepository.class));

        assertThatThrownBy(
                        () ->
                                service.addCompany(
                                        7L,
                                        companyRequest(
                                                null,
                                                null,
                                                ProcurementCompanyStatus.REJECTED,
                                                "   ")))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("Для отклонённой компании укажите причину решения");
    }

    @Test
    void savesCompanyWorkflowStatusAndNormalizesDecisionComment() {
        ProcurementProjectRepository projects = mock(ProcurementProjectRepository.class);
        ProcurementCompanyRepository companies = mock(ProcurementCompanyRepository.class);
        ProcurementCompanyLinkRepository companyLinks =
                mock(ProcurementCompanyLinkRepository.class);
        when(projects.findById(7L)).thenReturn(Optional.of(new ProcurementProject()));
        when(companies.save(any(ProcurementCompany.class)))
                .thenAnswer(
                        invocation -> {
                            ProcurementCompany company = invocation.getArgument(0);
                            company.id = 17L;
                            return company;
                        });
        ProcurementService service = service(projects, companies, companyLinks);

        var result =
                service.addCompany(
                        7L,
                        companyRequest(
                                null,
                                null,
                                ProcurementCompanyStatus.REJECTED,
                                "  Цена не подошла  "));

        assertThat(result.companyStatus()).isEqualTo(ProcurementCompanyStatus.REJECTED);
        assertThat(result.decisionComment()).isEqualTo("Цена не подошла");
    }

    @Test
    void keepsCompanyWorkflowWhenLegacyUpdateOmitsWorkflowFields() {
        ProcurementCompanyRepository companies = mock(ProcurementCompanyRepository.class);
        ProcurementCompanyLinkRepository companyLinks =
                mock(ProcurementCompanyLinkRepository.class);
        ProcurementCompany existing = new ProcurementCompany();
        existing.id = 17L;
        existing.projectId = 7L;
        existing.status = ProcurementCompanyStatus.SELECTED;
        existing.decisionComment = "Согласовано для закупки";
        when(companies.findByIdAndProjectId(17L, 7L)).thenReturn(Optional.of(existing));
        when(companies.save(any(ProcurementCompany.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        ProcurementService service =
                service(mock(ProcurementProjectRepository.class), companies, companyLinks);

        var result = service.updateCompany(7L, 17L, companyRequest(null));

        assertThat(result.companyStatus()).isEqualTo(ProcurementCompanyStatus.SELECTED);
        assertThat(result.decisionComment()).isEqualTo("Согласовано для закупки");
    }

    private ProcurementCompanyRequest companyRequest(BigDecimal price) {
        return companyRequest(price, null);
    }

    private ProcurementCompanyRequest companyRequest(BigDecimal price, String priceCurrency) {
        return companyRequest(price, priceCurrency, null, null);
    }

    private ProcurementCompanyRequest companyRequest(
            BigDecimal price,
            String priceCurrency,
            ProcurementCompanyStatus status,
            String decisionComment) {
        return new ProcurementCompanyRequest(
                "Поставщик",
                null,
                null,
                null,
                null,
                null,
                List.of(),
                price,
                priceCurrency,
                status,
                decisionComment);
    }

    private ProcurementService service(
            ProcurementProjectRepository projects,
            ProcurementCompanyRepository companies,
            ProcurementCompanyLinkRepository companyLinks) {
        return new ProcurementService(
                projects,
                companies,
                companyLinks,
                mock(ProcurementCompanyNoteRepository.class),
                mock(ProcurementFileRepository.class),
                mock(ProcurementPaymentRepository.class),
                mock(ProcurementStatusHistoryRepository.class),
                mock(FileStorageService.class),
                mock(AuditService.class));
    }
}
