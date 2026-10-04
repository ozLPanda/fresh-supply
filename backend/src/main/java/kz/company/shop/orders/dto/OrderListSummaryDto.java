package kz.company.shop.orders.dto;

public record OrderListSummaryDto(long total, long newOrders, long processing, long ready) {}
