package kz.company.shop.whatsapp;

import java.util.List;

public record WhatsAppPageDto<T>(List<T> items, long total, int page, int size) {}
