package kz.company.shop.integrations.gpt;

public class GptProviderException extends RuntimeException {
    public GptProviderException(String message) {
        super(message);
    }

    public GptProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
