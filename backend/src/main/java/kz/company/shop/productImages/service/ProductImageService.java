package kz.company.shop.productImages.service;

import java.util.List;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.productImages.entity.ProductImage;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.dto.ProductImageDto;
import kz.company.shop.products.service.ProductService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ProductImageService {
    private final ProductImageRepository repository;
    private final ProductService productService;
    private final FileStorageService fileStorageService;

    public ProductImageService(
            ProductImageRepository repository,
            ProductService productService,
            FileStorageService fileStorageService) {
        this.repository = repository;
        this.productService = productService;
        this.fileStorageService = fileStorageService;
    }

    @Transactional
    public ProductImageDto upload(Long productId, MultipartFile file) {
        long count = repository.countByProductId(productId);
        if (count >= 10)
            throw new AppExceptions.BadRequest("У товара может быть максимум 10 изображений");
        FileStorageService.StoredFile stored = fileStorageService.saveProductImage(file);
        ProductImage image = new ProductImage();
        image.product = productService.getEntity(productId);
        image.fileName = stored.fileName();
        image.originalFileName = stored.originalFileName();
        image.filePath = stored.publicPath();
        image.contentHash = stored.contentHash();
        image.sortOrder = (int) count + 1;
        image.mainImage = image.sortOrder == 1;
        return productService.imageDto(repository.save(image));
    }

    @Transactional
    public List<ProductImageDto> delete(Long productId, Long imageId) {
        productService.getEntity(productId);
        ProductImage image =
                repository
                        .findByIdAndProductId(imageId, productId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Изображение не найдено"));
        boolean wasMain = image.mainImage;
        fileStorageService.deleteProductImage(image.fileName);
        repository.delete(image);
        repository.flush();

        List<ProductImage> remaining = repository.findByProductIdOrderBySortOrderAsc(productId);
        for (int index = 0; index < remaining.size(); index++) {
            ProductImage item = remaining.get(index);
            item.sortOrder = index + 1;
            if (wasMain) item.mainImage = index == 0;
        }
        return repository.saveAll(remaining).stream().map(productService::imageDto).toList();
    }

    @Transactional
    public List<ProductImageDto> setMain(Long productId, Long imageId) {
        productService.getEntity(productId);
        ProductImage selected =
                repository
                        .findByIdAndProductId(imageId, productId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Изображение не найдено"));
        List<ProductImage> images = repository.findByProductIdOrderBySortOrderAsc(productId);
        images.forEach(image -> image.mainImage = image.id.equals(selected.id));
        return repository.saveAll(images).stream().map(productService::imageDto).toList();
    }
}
