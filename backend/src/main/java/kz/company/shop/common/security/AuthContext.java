package kz.company.shop.common.security;

import java.util.Optional;
import kz.company.shop.common.exception.AppExceptions;
import org.springframework.stereotype.Component;

@Component
public class AuthContext {
    private static final ThreadLocal<CurrentUser> CURRENT = new ThreadLocal<>();

    void set(CurrentUser user) {
        CURRENT.set(user);
    }

    public CurrentUser current() {
        CurrentUser user = CURRENT.get();
        if (user == null) throw new AppExceptions.Forbidden("authenticated");
        return user;
    }

    public Optional<CurrentUser> optional() {
        return Optional.ofNullable(CURRENT.get());
    }

    public void require(String permission) {
        if (!current().permissions().contains(permission))
            throw new AppExceptions.Forbidden(permission);
    }

    void clear() {
        CURRENT.remove();
    }
}
