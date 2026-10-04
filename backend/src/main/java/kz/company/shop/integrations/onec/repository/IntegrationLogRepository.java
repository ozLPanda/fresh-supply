package kz.company.shop.integrations.onec.repository;

import kz.company.shop.integrations.onec.entity.IntegrationLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface IntegrationLogRepository extends JpaRepository<IntegrationLog, Long> {
    @Query(
            "select count(l) from IntegrationLog l "
                    + "where lower(l.status) in ('error', 'failed', 'failure')")
    long countErrors();
}
