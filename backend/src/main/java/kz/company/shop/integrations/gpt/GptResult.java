package kz.company.shop.integrations.gpt;

public record GptResult(String text, String responseId, Long inputTokens, Long outputTokens) {}
