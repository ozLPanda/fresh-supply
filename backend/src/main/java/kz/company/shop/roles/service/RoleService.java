package kz.company.shop.roles.service;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.permissions.repository.PermissionRepository;
import kz.company.shop.roles.dto.RoleDto;
import kz.company.shop.roles.entity.Role;
import kz.company.shop.roles.repository.RoleRepository;
import kz.company.shop.users.service.UserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RoleService {
    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final UserService userService;

    public RoleService(
            RoleRepository roleRepository,
            PermissionRepository permissionRepository,
            UserService userService) {
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.userService = userService;
    }

    public List<RoleDto> list() {
        return roleRepository.findAll().stream().map(this::toDto).toList();
    }

    @Transactional
    public RoleDto create(RoleDto dto, Long actorId) {
        requireAdministrator(actorId);
        if (roleRepository.existsByCode(dto.code()))
            throw new AppExceptions.BadRequest("Роль с таким кодом уже существует");
        Role role = new Role();
        apply(role, dto);
        return toDto(roleRepository.save(role));
    }

    @Transactional
    public RoleDto update(Long id, RoleDto dto, Long actorId) {
        requireAdministrator(actorId);
        Role role =
                roleRepository
                        .findById(id)
                        .orElseThrow(() -> new AppExceptions.NotFound("Роль не найдена"));
        if (roleRepository.existsByCodeAndIdNot(dto.code(), id)) {
            throw new AppExceptions.BadRequest("Роль с таким кодом уже существует");
        }
        apply(role, dto);
        return toDto(roleRepository.save(role));
    }

    private void apply(Role role, RoleDto dto) {
        role.code = dto.code();
        role.nameRu = dto.nameRu();
        role.nameKk = dto.nameKk();
        role.active = dto.active();
        role.permissions =
                dto.permissionIds() == null
                        ? Set.of()
                        : new HashSet<>(permissionRepository.findByIdIn(dto.permissionIds()));
    }

    private void requireAdministrator(Long actorId) {
        if (!userService.isAdministrator(actorId)) {
            throw new AppExceptions.Forbidden("administrator");
        }
    }

    public RoleDto toDto(Role role) {
        return new RoleDto(
                role.id,
                role.code,
                role.nameRu,
                role.nameKk,
                role.active,
                role.permissions.stream().map(p -> p.id).collect(Collectors.toSet()),
                role.permissions.stream().map(p -> p.code).collect(Collectors.toSet()));
    }
}
