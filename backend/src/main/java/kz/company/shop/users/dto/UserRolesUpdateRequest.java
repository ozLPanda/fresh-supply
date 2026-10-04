package kz.company.shop.users.dto;

import java.util.Set;

public record UserRolesUpdateRequest(Set<Long> roleIds) {}
