package kz.company.shop.categories.controller;

import jakarta.validation.Valid;
import java.util.List;
import kz.company.shop.categories.dto.CategoryDto;
import kz.company.shop.categories.dto.CategoryListParams;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/categories")
public class CategoryController {
    private final CategoryService categoryService;
    private final AuthContext auth;

    public CategoryController(CategoryService categoryService, AuthContext auth) {
        this.categoryService = categoryService;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<PageResult<CategoryDto>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "12") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String direction) {
        return ApiResponse.ok(
                categoryService.list(
                        new CategoryListParams(page, size, search, active, sort, direction)));
    }

    @GetMapping("/{id}")
    public ApiResponse<CategoryDto> get(@PathVariable Long id) {
        return ApiResponse.ok(categoryService.get(id));
    }

    @GetMapping("/tree")
    public ApiResponse<List<CategoryDto>> tree() {
        return ApiResponse.ok(categoryService.tree());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('categories.create')")
    public ApiResponse<CategoryDto> create(@RequestBody @Valid CategoryDto dto) {
        auth.require("categories.create");
        return ApiResponse.ok(categoryService.create(dto));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('categories.update')")
    public ApiResponse<CategoryDto> update(
            @PathVariable Long id, @RequestBody @Valid CategoryDto dto) {
        auth.require("categories.update");
        return ApiResponse.ok(categoryService.update(id, dto));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('categories.delete')")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        auth.require("categories.delete");
        categoryService.delete(id);
        return ApiResponse.message("Категория удалена");
    }

    @PostMapping(value = "/{id}/image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('categories.update')")
    public ApiResponse<CategoryDto> uploadImage(
            @PathVariable Long id, @RequestParam("file") MultipartFile file) {
        auth.require("categories.update");
        return ApiResponse.ok(categoryService.uploadImage(id, file));
    }

    @DeleteMapping("/{id}/image")
    @PreAuthorize("hasAuthority('categories.update')")
    public ApiResponse<CategoryDto> deleteImage(@PathVariable Long id) {
        auth.require("categories.update");
        return ApiResponse.ok(categoryService.deleteImage(id));
    }
}
