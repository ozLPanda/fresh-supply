package kz.company.shop.permissions.repository;

import java.util.Collection;
import java.util.List;
import kz.company.shop.permissions.entity.Permission;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PermissionRepository extends JpaRepository<Permission, Long> {
    List<Permission> findByIdIn(Collection<Long> ids);

    List<Permission> findByCodeIn(Collection<String> codes);
}
