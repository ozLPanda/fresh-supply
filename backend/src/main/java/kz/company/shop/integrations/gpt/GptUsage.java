package kz.company.shop.integrations.gpt;

record GptUsage(
        String responseId,
        String feature,
        String model,
        String status,
        Integer httpStatus,
        Long inputTokens,
        Long outputTokens,
        Long totalTokens,
        Long cachedInputTokens,
        Long cacheWriteTokens,
        Long reasoningOutputTokens,
        long durationMs) {}
