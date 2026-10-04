package kz.company.shop.roles.repository;

import java.util.Collection;
import java.util.List;
import kz.company.shop.roles.entity.Role;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, Long> {
    List<Role> findByIdIn(Collection<Long> ids);

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);
}
