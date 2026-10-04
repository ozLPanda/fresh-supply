package kz.company.shop.users.repository;

import java.util.List;
import java.util.Optional;
import kz.company.shop.users.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmailAndDeletedAtIsNull(String email);

    boolean existsByEmail(String email);

    Optional<User> findByPhoneAndDeletedAtIsNull(String phone);

    boolean existsByPhone(String phone);

    @Query(
            "select count(u) from User u join u.roles r "
                    + "where u.active = true and u.deletedAt is null "
                    + "and r.active = true and r.code = :roleCode")
    long countActiveByRoleCode(@Param("roleCode") String roleCode);

    @Query(
            "select distinct u from User u "
                    + "left join u.permissions directPermission "
                    + "left join u.roles role "
                    + "left join role.permissions rolePermission "
                    + "where u.active = true and u.deletedAt is null "
                    + "and (directPermission.code = :permission "
                    + "or (role.active = true and rolePermission.code = :permission))")
    List<User> findActiveWithPermission(@Param("permission") String permission);

    @Query(
            "select distinct u from User u join u.roles role "
                    + "where u.active = true and u.deletedAt is null "
                    + "and role.active = true and role.code = 'administrator' order by u.name")
    List<User> findActiveAdministrators();
}
