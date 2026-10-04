package kz.company.shop.settings.service;

import java.util.LinkedHashSet;
import java.util.List;
import kz.company.shop.search.EmbeddingProperties;
import kz.company.shop.settings.dto.ProjectSettingsDto;
import kz.company.shop.settings.dto.ProjectSettingsUpdateRequest;
import kz.company.shop.settings.entity.ProjectSetting;
import kz.company.shop.settings.repository.ProjectSettingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectSettingsService {
    private static final String SEARCH_AI_ENABLED = "search.ai.enabled";
    private static final String WHOLESALE_MIN_QUANTITY = "commerce.wholesale.minQuantity";
    private static final String PRICE_IMPORT_EXCLUDED_NAME_TERMS = "priceImport.excludedNameTerms";
    private static final int DEFAULT_WHOLESALE_MIN_QUANTITY = 10;

    private final ProjectSettingRepository repository;
    private final EmbeddingProperties embeddingProperties;

    public ProjectSettingsService(
            ProjectSettingRepository repository, EmbeddingProperties embeddingProperties) {
        this.repository = repository;
        this.embeddingProperties = embeddingProperties;
    }

    @Transactional(readOnly = true)
    public ProjectSettingsDto get() {
        return new ProjectSettingsDto(
                searchAiEnabled(),
                embeddingProperties.isEnabled(),
                wholesaleMinQuantity(),
                priceImportExcludedNameTerms());
    }

    @Transactional(readOnly = true)
    public boolean searchAiEnabled() {
        return repository
                .findById(SEARCH_AI_ENABLED)
                .map(setting -> Boolean.parseBoolean(setting.value))
                .orElse(true);
    }

    @Transactional(readOnly = true)
    public int wholesaleMinQuantity() {
        return repository
                .findById(WHOLESALE_MIN_QUANTITY)
                .map(setting -> parsePositiveInt(setting.value, DEFAULT_WHOLESALE_MIN_QUANTITY))
                .orElse(DEFAULT_WHOLESALE_MIN_QUANTITY);
    }

    @Transactional(readOnly = true)
    public List<String> priceImportExcludedNameTerms() {
        return repository
                .findById(PRICE_IMPORT_EXCLUDED_NAME_TERMS)
                .map(setting -> parseNameTerms(setting.value))
                .orElseGet(List::of);
    }

    @Transactional
    public ProjectSettingsDto update(ProjectSettingsUpdateRequest request) {
        save(SEARCH_AI_ENABLED, Boolean.toString(Boolean.TRUE.equals(request.searchAiEnabled())));
        save(WHOLESALE_MIN_QUANTITY, Integer.toString(request.wholesaleMinQuantity()));
        save(
                PRICE_IMPORT_EXCLUDED_NAME_TERMS,
                String.join("\n", parseNameTerms(request.priceImportExcludedNameTerms())));
        return get();
    }

    private void save(String key, String value) {
        ProjectSetting setting =
                repository
                        .findById(key)
                        .orElseGet(
                                () -> {
                                    ProjectSetting created = new ProjectSetting();
                                    created.key = key;
                                    return created;
                                });
        setting.value = value;
        repository.save(setting);
    }

    private int parsePositiveInt(String value, int fallback) {
        try {
            int parsed = Integer.parseInt(value);
            return parsed >= 1 && parsed <= 999 ? parsed : fallback;
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    private List<String> parseNameTerms(List<String> values) {
        if (values == null) return List.of();
        return values.stream()
                .filter(value -> value != null && !value.isBlank())
                .map(String::trim)
                .collect(
                        java.util.stream.Collectors.collectingAndThen(
                                java.util.stream.Collectors.toCollection(LinkedHashSet::new),
                                List::copyOf));
    }

    private List<String> parseNameTerms(String value) {
        if (value == null || value.isBlank()) return List.of();
        return parseNameTerms(List.of(value.split("[\\r\\n,]+")));
    }
}
