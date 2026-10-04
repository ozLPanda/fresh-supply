package kz.company.shop.alibabaSourcing.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingOffer;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AlibabaSourcingOfferRepository extends JpaRepository<AlibabaSourcingOffer, Long> {
    List<AlibabaSourcingOffer> findBySearchIdOrderByPositionAsc(UUID searchId);

    Optional<AlibabaSourcingOffer> findByIdAndSearchId(Long id, UUID searchId);
}
