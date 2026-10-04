package kz.company.shop.supplierproducts;

import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.users.repository.UserRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class SupplierProductAccess {
    private final AuthContext auth;
    private final UserRepository users;

    public SupplierProductAccess(AuthContext auth, UserRepository users) {
        this.auth = auth;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public void requireRead() {
        auth.require("pages.supplier-products.view");
        var user =
                users.findById(auth.current().id())
                        .orElseThrow(
                                () -> new AppExceptions.Forbidden("pages.supplier-products.view"));
        if (!user.active || user.deletedAt != null)
            throw new AppExceptions.Forbidden("pages.supplier-products.view");
    }

    public void requireImport() {
        requireRead();
        auth.require("supplier-products.import");
        auth.require("pages.mks.view");
    }
}
