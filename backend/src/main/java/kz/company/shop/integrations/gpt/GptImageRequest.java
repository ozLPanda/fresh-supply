package kz.company.shop.integrations.gpt;

import java.util.List;

/** Images are supplied as data URLs and sent only to the configured Responses API. */
public record GptImageRequest(
        String feature,
        String instructions,
        String input,
        List<String> imageDataUrls,
        Integer maxOutputTokens) {}
