package kz.company.shop.categories.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.categories.dto.CategoryListParams;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.search.SearchEmbeddingIndexer;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

class CategoryServiceTest {
    private final CategoryRepository categories = mock(CategoryRepository.class);
    private final FileStorageService files = mock(FileStorageService.class);
    private final CategoryService service =
            new CategoryService(
                    categories,
                    files,
                    mock(AuditService.class),
                    mock(SearchEmbeddingIndexer.class));

    @Test
    void omitsADeletedImageInsteadOfFailingTheCategoryList() {
        Category category = new Category();
        category.id = 1L;
        category.nameRu = "Насосы";
        category.nameKk = "Сорғылар";
        category.slug = "nasosy";
        category.imageFileName = "missing.webp";
        category.imageOriginalFileName = "missing.webp";
        category.imageFilePath = "/uploads/missing.webp";

        when(categories.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(category)));
        when(files.contentHash("missing.webp"))
                .thenThrow(new AppExceptions.NotFound("Файл не найден"));

        var result = service.list(new CategoryListParams(1, 20, null, null, null, null));

        assertThat(result.items())
                .singleElement()
                .satisfies(
                        dto -> {
                            assertThat(dto.imageFileName()).isNull();
                            assertThat(dto.imageFilePath()).isNull();
                            assertThat(dto.imageContentHash()).isNull();
                        });
        assertThat(category.imageFileName).isNull();
    }
}
