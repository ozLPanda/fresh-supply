package kz.company.shop.files.config;

import io.minio.MinioClient;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ObjectStorageConfig.Properties.class)
public class ObjectStorageConfig {
    @Bean
    MinioClient minioClient(Properties properties) {
        return MinioClient.builder()
                .endpoint(properties.endpoint())
                .credentials(properties.accessKey(), properties.secretKey())
                .build();
    }

    @ConfigurationProperties("app.files.storage")
    public record Properties(String endpoint, String accessKey, String secretKey, String bucket) {}
}
