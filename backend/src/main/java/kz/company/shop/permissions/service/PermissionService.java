package kz.company.shop.permissions.service;

import java.util.List;
import kz.company.shop.permissions.dto.PermissionDto;
import kz.company.shop.permissions.entity.Permission;
import kz.company.shop.permissions.repository.PermissionRepository;
import org.springframework.stereotype.Service;

@Service
public class PermissionService {
    private final PermissionRepository repository;

    public PermissionService(PermissionRepository repository) {
        this.repository = repository;
    }

    public List<PermissionDto> list() {
        return repository.findAll().stream().map(this::toDto).toList();
    }

    public PermissionDto toDto(Permission permission) {
        return new PermissionDto(
                permission.id,
                permission.code,
                permission.entityName,
                permission.actionName,
                permission.nameRu);
    }
}
