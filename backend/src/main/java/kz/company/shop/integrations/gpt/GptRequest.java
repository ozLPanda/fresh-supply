package kz.company.shop.integrations.gpt;

/** Instructions and input are kept separate so each feature controls its own prompt. */
public record GptRequest(
        String feature, String instructions, String input, Integer maxOutputTokens) {}
