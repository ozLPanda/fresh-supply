package kz.company.shop.alibabaSourcing.integration;

/** A controlled failure when the external Alibaba integration cannot supply results. */
public class AlibabaSourcingIntegrationException extends RuntimeException {
    public static final String INTEGRATION_UNAVAILABLE = "ALIBABA_INTEGRATION_UNAVAILABLE";

    private final String errorCode;

    public AlibabaSourcingIntegrationException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public AlibabaSourcingIntegrationException(String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public String getErrorCode() {
        return errorCode;
    }
}
