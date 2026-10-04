package kz.company.shop.regularbuyers.repository;

import java.util.List;
import java.util.UUID;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RegularBuyerRepository extends JpaRepository<RegularBuyer, UUID> {
    List<RegularBuyer> findAllByOrderByNameAsc();
    List<RegularBuyer> findByArchivedFalseOrderByNameAsc();
}
