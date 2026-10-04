package kz.company.shop.settings.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import kz.company.shop.settings.dto.PaymentInvoiceSettingsDto;
import kz.company.shop.settings.entity.ProjectSetting;
import kz.company.shop.settings.repository.ProjectSettingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentInvoiceSettingsService {
    private static final String KEY = "orders.paymentInvoice";
    private final ProjectSettingRepository repository;
    private final ObjectMapper mapper;

    public PaymentInvoiceSettingsService(ProjectSettingRepository repository, ObjectMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public PaymentInvoiceSettingsDto get() {
        return repository.findById(KEY).map(setting -> read(setting.value))
                .orElseGet(PaymentInvoiceSettingsDto::defaults);
    }

    @Transactional
    public PaymentInvoiceSettingsDto update(PaymentInvoiceSettingsDto settings) {
        ProjectSetting entity = repository.findById(KEY).orElseGet(ProjectSetting::new);
        entity.key = KEY;
        try {
            entity.value = mapper.writeValueAsString(settings);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Не удалось сохранить реквизиты счёта", e);
        }
        repository.save(entity);
        return settings;
    }

    private PaymentInvoiceSettingsDto read(String json) {
        try {
            return mapper.readValue(json, PaymentInvoiceSettingsDto.class);
        } catch (JsonProcessingException e) {
            // Never silently replace a saved bank account with the example account.
            throw new IllegalStateException("Не удалось прочитать реквизиты счёта", e);
        }
    }
}
