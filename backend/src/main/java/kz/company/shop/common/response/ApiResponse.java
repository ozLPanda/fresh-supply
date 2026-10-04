package kz.company.shop.common.response;

import java.util.Map;

public record ApiResponse<T>(boolean success, String message, T data, Map<String, ?> errors) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, null, data, null);
    }

    public static ApiResponse<Void> message(String message) {
        return new ApiResponse<>(true, message, null, null);
    }

    public static ApiResponse<Void> error(String message, Map<String, ?> errors) {
        return new ApiResponse<>(false, message, null, errors);
    }
}
