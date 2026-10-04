package kz.company.shop.integrations.onec.repository;

import java.util.Optional;
import kz.company.shop.integrations.onec.entity.ExternalApiCredential;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExternalApiCredentialRepository
        extends JpaRepository<ExternalApiCredential, Long> {
    boolean existsByAccessCode(String accessCode);

    Optional<ExternalApiCredential> findByAccessCode(String accessCode);
}
