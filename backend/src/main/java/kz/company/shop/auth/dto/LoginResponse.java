package kz.company.shop.auth.dto;

import kz.company.shop.users.dto.UserDto;

public record LoginResponse(String token, UserDto user) {}
