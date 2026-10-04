package kz.company.shop.mks;

import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.users.repository.UserRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class MksAccess {
    private final AuthContext auth;
    private final UserRepository users;

    public MksAccess(AuthContext auth, UserRepository users) {
        this.auth = auth;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public void requireCatalogAccess() {
        auth.require("pages.mks.view");
        var user =
                users.findById(auth.current().id())
                        .orElseThrow(() -> new AppExceptions.Forbidden("pages.mks.view"));
        if (!user.active || user.deletedAt != null) {
            throw new AppExceptions.Forbidden("pages.mks.view");
        }
    }
}
