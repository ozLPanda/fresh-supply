package kz.company.shop.categories.service;

import jakarta.persistence.criteria.JoinType;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.categories.dto.CategoryDto;
import kz.company.shop.categories.dto.CategoryListParams;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import kz.company.shop.search.SearchEmbeddingIndexer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class CategoryService {
    private static final int MIN_PAGE = 1;
    private static final int MIN_SIZE = 1;
    private static final int MAX_SIZE = 200;

    private final CategoryRepository repository;
    private final FileStorageService fileStorageService;
    private final AuditService auditService;
    private final SearchEmbeddingIndexer searchEmbeddingIndexer;

    public CategoryService(
            CategoryRepository repository,
            FileStorageService fileStorageService,
            AuditService auditService,
            SearchEmbeddingIndexer searchEmbeddingIndexer) {
        this.repository = repository;
        this.fileStorageService = fileStorageService;
        this.auditService = auditService;
        this.searchEmbeddingIndexer = searchEmbeddingIndexer;
    }

    @Transactional
    public PageResult<CategoryDto> list(CategoryListParams params) {
        int safePage = Math.max(params.page(), MIN_PAGE);
        int safeSize = Math.min(Math.max(params.size(), MIN_SIZE), MAX_SIZE);
        PageRequest pageable =
                PageRequest.of(
                        safePage - 1, safeSize, resolveSort(params.sort(), params.direction()));
        Page<CategoryDto> result =
                repository.findAll(buildSpecification(params), pageable).map(this::toDto);
        return new PageResult<>(
                result.getContent(),
                result.getNumber() + 1,
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    @Transactional
    public List<CategoryDto> tree() {
        List<CategoryDto> flat =
                repository.findByDeletedAtIsNullOrderBySortOrderAscNameRuAsc().stream()
                        .filter(this::isRenderableCategory)
                        .map(this::toDto)
                        .toList();

        Map<Long, List<CategoryDto>> childrenByParent = new HashMap<>();
        for (CategoryDto category : flat) {
            if (category.parentId() == null || category.id() == null) continue;
            childrenByParent
                    .computeIfAbsent(category.parentId(), key -> new ArrayList<>())
                    .add(category);
        }

        return flat.stream()
                .filter(category -> category.parentId() == null)
                .map(category -> toTreeDto(category, childrenByParent))
                .toList();
    }

    public Category getEntity(Long id) {
        return repository
                .findById(id)
                .filter(category -> category.deletedAt == null)
                .orElseThrow(() -> new AppExceptions.NotFound("Категория не найдена"));
    }

    @Transactional
    public CategoryDto get(Long id) {
        return toDto(getEntity(id));
    }

    public String nameRu(Long id) {
        if (id == null) return null;
        return namesRu(List.of(id)).get(id);
    }

    public Map<Long, String> namesRu(Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) return Map.of();
        List<Long> categoryIds =
                ids.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (categoryIds.isEmpty()) return Map.of();
        return repository.findNamesRuByIdIn(categoryIds).stream()
                .collect(
                        java.util.stream.Collectors.toMap(
                                CategoryRepository.NameRuProjection::getId,
                                CategoryRepository.NameRuProjection::getNameRu));
    }

    @Transactional
    public CategoryDto create(CategoryDto dto) {
        if (repository.existsBySlugAndDeletedAtIsNull(dto.slug()))
            throw new AppExceptions.BadRequest("Slug категории уже используется");
        Category category = new Category();
        apply(category, dto);
        Category saved = repository.save(category);
        searchEmbeddingIndexer.indexCategory(saved);
        auditService.record(
                "CREATE", "CATEGORY", saved.id, "Создал категорию «" + saved.nameRu + "»");
        return toDto(saved);
    }

    @Transactional
    public CategoryDto update(Long id, CategoryDto dto) {
        Category category = getEntity(id);
        if (repository.existsBySlugAndDeletedAtIsNullAndIdNot(dto.slug(), id))
            throw new AppExceptions.BadRequest("Slug категории уже используется");
        apply(category, dto);
        Category saved = repository.save(category);
        searchEmbeddingIndexer.indexCategory(saved);
        auditService.record(
                "UPDATE", "CATEGORY", saved.id, "Обновил категорию «" + saved.nameRu + "»");
        return toDto(saved);
    }

    @Transactional
    public void delete(Long id) {
        Category category = getEntity(id);
        deleteImageFile(category);
        category.imageFileName = null;
        category.imageOriginalFileName = null;
        category.imageFilePath = null;
        category.imageContentHash = null;
        category.deletedAt = Instant.now();
        repository.save(category);
        auditService.record(
                "DELETE", "CATEGORY", category.id, "Удалил категорию «" + category.nameRu + "»");
    }

    @Transactional
    public CategoryDto uploadImage(Long id, MultipartFile file) {
        Category category = getEntity(id);
        FileStorageService.StoredFile stored = fileStorageService.saveProductImage(file);
        deleteImageFile(category);
        category.imageFileName = stored.fileName();
        category.imageOriginalFileName = stored.originalFileName();
        category.imageFilePath = stored.publicPath();
        category.imageContentHash = stored.contentHash();
        Category saved = repository.save(category);
        auditService.record(
                "UPDATE",
                "CATEGORY",
                saved.id,
                "Обновил изображение категории «" + saved.nameRu + "»");
        return toDto(saved);
    }

    @Transactional
    public CategoryDto deleteImage(Long id) {
        Category category = getEntity(id);
        deleteImageFile(category);
        category.imageFileName = null;
        category.imageOriginalFileName = null;
        category.imageFilePath = null;
        category.imageContentHash = null;
        Category saved = repository.save(category);
        auditService.record(
                "UPDATE",
                "CATEGORY",
                saved.id,
                "Удалил изображение категории «" + saved.nameRu + "»");
        return toDto(saved);
    }

    private Specification<Category> buildSpecification(CategoryListParams params) {
        return Specification.where(notDeleted())
                .and(renderable())
                .and(matchesSearch(params.search()))
                .and(matchesActive(params.active()));
    }

    private Specification<Category> notDeleted() {
        return (root, query, cb) -> cb.isNull(root.get("deletedAt"));
    }

    private Specification<Category> renderable() {
        return (root, query, cb) ->
                cb.and(
                        cb.isNotNull(root.get("id")),
                        cb.isNotNull(root.get("nameRu")),
                        cb.notEqual(cb.trim(root.get("nameRu")), ""),
                        cb.isNotNull(root.get("nameKk")),
                        cb.notEqual(cb.trim(root.get("nameKk")), ""),
                        cb.isNotNull(root.get("slug")),
                        cb.notEqual(cb.trim(root.get("slug")), ""));
    }

    private Specification<Category> matchesSearch(String rawSearch) {
        List<String> searchVariants = ProductSearchTextNormalizer.rawSearchVariants(rawSearch);
        if (searchVariants.isEmpty()) return null;
        return (root, query, cb) -> {
            var parent = root.join("parent", JoinType.LEFT);
            List<jakarta.persistence.criteria.Predicate> matches = new ArrayList<>();
            for (String search : searchVariants) {
                String like = "%" + search + "%";
                matches.add(
                        cb.or(
                                cb.like(cb.lower(root.get("nameRu")), like),
                                cb.like(cb.lower(root.get("nameKk")), like),
                                cb.like(cb.lower(root.get("slug")), like),
                                cb.like(
                                        cb.lower(cb.coalesce(root.get("descriptionRu"), "")),
                                        like),
                                cb.like(
                                        cb.lower(cb.coalesce(parent.get("nameRu"), "")),
                                        like)));
            }
            return cb.or(matches.toArray(jakarta.persistence.criteria.Predicate[]::new));
        };
    }

    private Specification<Category> matchesActive(Boolean active) {
        if (active == null) return null;
        return (root, query, cb) ->
                active ? cb.isTrue(root.get("active")) : cb.isFalse(root.get("active"));
    }

    private Sort resolveSort(String sort, String direction) {
        String normalizedSort = sort == null || sort.isBlank() ? "sortOrder" : sort.trim();
        Sort.Direction sortDirection =
                "desc".equalsIgnoreCase(direction) ? Sort.Direction.DESC : Sort.Direction.ASC;
        return switch (normalizedSort) {
            case "nameRu" -> Sort.by(new Sort.Order(sortDirection, "nameRu").ignoreCase());
            case "slug" -> Sort.by(new Sort.Order(sortDirection, "slug").ignoreCase());
            case "active" -> Sort.by(new Sort.Order(sortDirection, "active"));
            case "parentNameRu" ->
                    Sort.by(new Sort.Order(sortDirection, "parent.nameRu").ignoreCase())
                            .and(
                                    Sort.by(
                                            new Sort.Order(Sort.Direction.ASC, "nameRu")
                                                    .ignoreCase()));
            case "sortOrder" ->
                    Sort.by(new Sort.Order(sortDirection, "sortOrder"))
                            .and(
                                    Sort.by(
                                            new Sort.Order(Sort.Direction.ASC, "nameRu")
                                                    .ignoreCase()));
            default ->
                    Sort.by(new Sort.Order(Sort.Direction.ASC, "sortOrder"))
                            .and(
                                    Sort.by(
                                            new Sort.Order(Sort.Direction.ASC, "nameRu")
                                                    .ignoreCase()));
        };
    }

    private void apply(Category category, CategoryDto dto) {
        category.parent = resolveParent(category.id, dto.parentId());
        category.nameRu = dto.nameRu();
        category.nameKk = dto.nameKk();
        category.descriptionRu = dto.descriptionRu();
        category.descriptionKk = dto.descriptionKk();
        category.slug = dto.slug();
        category.sortOrder = dto.sortOrder();
        category.active = dto.active();
    }

    private Category resolveParent(Long categoryId, Long parentId) {
        if (parentId == null) return null;
        if (categoryId != null && parentId.equals(categoryId)) {
            throw new AppExceptions.BadRequest("Категория не может быть родителем сама себе");
        }

        Category parent = getEntity(parentId);
        if (categoryId != null && createsCycle(categoryId, parent)) {
            throw new AppExceptions.BadRequest("Нельзя назначить дочернюю категорию родителем");
        }
        return parent;
    }

    private boolean createsCycle(Long categoryId, Category parent) {
        Set<Long> visited = new HashSet<>();
        Category current = parent;
        while (current != null && current.id != null && visited.add(current.id)) {
            if (current.id.equals(categoryId)) return true;
            current = current.parent == null ? null : getEntity(current.parent.id);
        }
        return current != null && current.id != null && !visited.add(current.id);
    }

    private CategoryDto toDto(Category category) {
        String contentHash = imageContentHash(category);
        boolean hasImage = contentHash != null;
        return new CategoryDto(
                category.id,
                category.parentId,
                category.nameRu,
                category.nameKk,
                category.parent != null ? category.parent.nameRu : null,
                category.descriptionRu,
                category.descriptionKk,
                hasImage ? category.imageFileName : null,
                hasImage ? category.imageOriginalFileName : null,
                hasImage ? category.imageFilePath : null,
                contentHash,
                category.slug,
                category.sortOrder,
                category.active,
                List.of());
    }

    private boolean isRenderableCategory(Category category) {
        return category.id != null
                && category.nameRu != null
                && !category.nameRu.isBlank()
                && category.nameKk != null
                && !category.nameKk.isBlank()
                && category.slug != null
                && !category.slug.isBlank();
    }

    private CategoryDto toTreeDto(
            CategoryDto category, Map<Long, List<CategoryDto>> childrenByParent) {
        List<CategoryDto> children =
                category.id() == null
                        ? List.of()
                        : childrenByParent.getOrDefault(category.id(), List.of()).stream()
                                .map(child -> toTreeDto(child, childrenByParent))
                                .toList();
        return new CategoryDto(
                category.id(),
                category.parentId(),
                category.nameRu(),
                category.nameKk(),
                category.parentNameRu(),
                category.descriptionRu(),
                category.descriptionKk(),
                category.imageFileName(),
                category.imageOriginalFileName(),
                category.imageFilePath(),
                category.imageContentHash(),
                category.slug(),
                category.sortOrder(),
                category.active(),
                children);
    }

    private String normalize(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return normalized.isBlank() ? null : normalized;
    }

    private void deleteImageFile(Category category) {
        if (category.imageFileName == null || category.imageFileName.isBlank()) return;
        fileStorageService.deleteProductImage(category.imageFileName);
    }

    private String imageContentHash(Category category) {
        if (category.imageFileName == null || category.imageFileName.isBlank()) return null;
        if (category.imageContentHash == null || category.imageContentHash.isBlank()) {
            try {
                category.imageContentHash = fileStorageService.contentHash(category.imageFileName);
            } catch (AppExceptions.NotFound ignored) {
                category.imageFileName = null;
                category.imageOriginalFileName = null;
                category.imageFilePath = null;
                category.imageContentHash = null;
                return null;
            }
        }
        return category.imageContentHash;
    }
}
