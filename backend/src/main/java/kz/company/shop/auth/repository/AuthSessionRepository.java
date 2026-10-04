package kz.company.shop.auth.repository;

import java.time.Instant;
import java.util.Optional;
import kz.company.shop.auth.entity.AuthSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuthSessionRepository extends JpaRepository<AuthSession, Long> {
    Optional<AuthSession> findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(
            String tokenHash, Instant now);

    Optional<AuthSession> findByTokenHashAndRevokedAtIsNull(String tokenHash);

    @Modifying
    @Query(
            "update AuthSession s set s.revokedAt = :revokedAt "
                    + "where s.userId = :userId and s.revokedAt is null")
    int revokeActiveByUserId(@Param("userId") Long userId, @Param("revokedAt") Instant revokedAt);
}
