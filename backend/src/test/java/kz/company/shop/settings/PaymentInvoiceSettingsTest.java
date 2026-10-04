package kz.company.shop.settings;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.settings.controller.PaymentInvoiceSettingsController;
import kz.company.shop.settings.dto.PaymentInvoiceSettingsDto;
import kz.company.shop.settings.entity.ProjectSetting;
import kz.company.shop.settings.repository.ProjectSettingRepository;
import kz.company.shop.settings.service.PaymentInvoiceSettingsService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PaymentInvoiceSettingsTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void defaultsThenSavedDetailsSurviveNewServiceInstance() {
        var repository = mock(ProjectSettingRepository.class);
        Map<String, ProjectSetting> stored = new HashMap<>();
        when(repository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(stored.get(i.getArgument(0))));
        when(repository.save(any())).thenAnswer(i -> {
            ProjectSetting entity = i.getArgument(0);
            stored.put(entity.key, entity);
            return entity;
        });
        var service = new PaymentInvoiceSettingsService(repository, mapper);
        assertThat(service.get()).isEqualTo(PaymentInvoiceSettingsDto.defaults());
        var update = new PaymentInvoiceSettingsDto(" Другой поставщик ", "123456789012", " Банк ",
                "kz64722s000056725357", "casp kzka".replace(" ", ""), "17", "720", "Договор №12", "Исполнитель", "");
        service.update(update);
        var loaded = new PaymentInvoiceSettingsService(repository, mapper).get();
        assertThat(loaded).isEqualTo(update);
        assertThat(loaded.supplierName()).isEqualTo("Другой поставщик");
        assertThat(loaded.iban()).isEqualTo("KZ64722S000056725357");
        assertThat(loaded.bic()).isEqualTo("CASPKZKA");
        assertThat(loaded.paymentTerms()).isEmpty();
    }

    @Test
    void corruptedSavedSettingsDoNotSilentlyUseExampleBankAccount() {
        var repository = mock(ProjectSettingRepository.class);
        var entity = new ProjectSetting();
        entity.value = "invalid json";
        when(repository.findById(any())).thenReturn(Optional.of(entity));
        assertThatThrownBy(() -> new PaymentInvoiceSettingsService(repository, mapper).get())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void validatesBankDetailsAndRequiresSettingsPermission() throws Exception {
        var service = mock(PaymentInvoiceSettingsService.class);
        var auth = mock(AuthContext.class);
        var mvc = MockMvcBuilders.standaloneSetup(new PaymentInvoiceSettingsController(service, auth))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        String path = "/api/admin/settings/payment-invoice";
        String valid = mapper.writeValueAsString(PaymentInvoiceSettingsDto.defaults());
        when(service.update(any())).thenAnswer(i -> i.getArgument(0));
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.iban").value("KZ64722S000056725357"));
        verify(auth).require("pages.settings.view");
        clearInvocations(service);
        for (String field : new String[]{"supplierTaxId", "iban", "bic", "beneficiaryCode", "paymentPurposeCode"}) {
            var json = mapper.readTree(valid);
            ((com.fasterxml.jackson.databind.node.ObjectNode)json).put(field, "!");
            mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(json.toString()))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
        var invalidChecksum = mapper.readTree(valid);
        ((com.fasterxml.jackson.databind.node.ObjectNode) invalidChecksum)
                .put("iban", "KZ65722S000056725357");
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(invalidChecksum.toString()))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
        doThrow(new AppExceptions.Forbidden("pages.settings.view")).when(auth).require("pages.settings.view");
        mvc.perform(get(path)).andExpect(status().isForbidden());
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(valid)).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
}
