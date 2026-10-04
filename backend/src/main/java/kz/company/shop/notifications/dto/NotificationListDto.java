package kz.company.shop.notifications.dto;

import java.util.List;

public record NotificationListDto(List<NotificationDto> items, long unreadCount) {}
