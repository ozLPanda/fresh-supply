package kz.company.shop.common.exception;

import jakarta.validation.ConstraintViolationException;
import java.util.*;
import kz.company.shop.common.response.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> validation(MethodArgumentNotValidException ex) {
        Map<String, List<String>> errors = new LinkedHashMap<>();
        ex.getBindingResult()
                .getFieldErrors()
                .forEach(
                        e ->
                                errors.computeIfAbsent(e.getField(), k -> new ArrayList<>())
                                        .add(e.getDefaultMessage()));
        return ApiResponse.error("Ошибка валидации", errors);
    }

    @ExceptionHandler({AppExceptions.BadRequest.class, ConstraintViolationException.class})
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> bad(Exception ex) {
        return ApiResponse.error(ex.getMessage(), Map.of());
    }

    @ExceptionHandler(AppExceptions.NotFound.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Void> notFound(Exception ex) {
        return ApiResponse.error(ex.getMessage(), Map.of());
    }

    @ExceptionHandler(AppExceptions.Unauthorized.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ApiResponse<Void> unauthorized(Exception ex) {
        return ApiResponse.error(ex.getMessage(), Map.of());
    }

    @ExceptionHandler(AppExceptions.Forbidden.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public ApiResponse<Void> forbidden(Exception ex) {
        return ApiResponse.error(ex.getMessage(), Map.of());
    }
}
