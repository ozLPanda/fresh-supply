package kz.company.shop.supplierproducts;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import org.junit.jupiter.api.Test;

class SupplierProductAccessTest {
    private final AuthContext auth = mock(AuthContext.class);
    private final UserRepository users = mock(UserRepository.class);
    private final SupplierProductAccess access = new SupplierProductAccess(auth, users);

    private User user() {
        when(auth.current())
                .thenReturn(new CurrentUser(7L, null, null, null, Set.of(), true, null));
        var user = new User();
        when(users.findById(7L)).thenReturn(Optional.of(user));
        return user;
    }

    @Test
    void checksReadPermissionAndActiveDatabaseUser() {
        var user = user();
        access.requireRead();
        verify(auth).require("pages.supplier-products.view");
        user.active = false;
        assertThatThrownBy(access::requireRead).isInstanceOf(AppExceptions.Forbidden.class);
        user.active = true;
        user.deletedAt = Instant.now();
        assertThatThrownBy(access::requireRead).isInstanceOf(AppExceptions.Forbidden.class);
    }

    @Test
    void rejectsMissingUserDespitePermission() {
        user();
        when(users.findById(7L)).thenReturn(Optional.empty());
        assertThatThrownBy(access::requireRead).isInstanceOf(AppExceptions.Forbidden.class);
    }

    @Test
    void importRequiresBothOperationAndMksPagePermission() {
        user();
        access.requireImport();
        verify(auth).require("pages.supplier-products.view");
        verify(auth).require("supplier-products.import");
        verify(auth).require("pages.mks.view");
    }

    @Test
    void unauthorizedReadDoesNotQueryDatabase() {
        doThrow(new AppExceptions.Forbidden("pages.supplier-products.view"))
                .when(auth)
                .require(anyString());
        assertThatThrownBy(access::requireRead).isInstanceOf(AppExceptions.Forbidden.class);
        verifyNoInteractions(users);
    }
}
