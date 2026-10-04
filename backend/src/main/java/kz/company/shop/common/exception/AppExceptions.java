package kz.company.shop.common.exception;

public final class AppExceptions {
    private AppExceptions() {}

    public static class BadRequest extends RuntimeException {
        public BadRequest(String message) {
            super(message);
        }
    }

    public static class NotFound extends RuntimeException {
        public NotFound(String message) {
            super(message);
        }
    }

    public static class Forbidden extends RuntimeException {
        public Forbidden(String permission) {
            super("Недостаточно прав: " + permission);
        }
    }

    public static class Unauthorized extends RuntimeException {
        public Unauthorized(String message) {
            super(message);
        }
    }
}
