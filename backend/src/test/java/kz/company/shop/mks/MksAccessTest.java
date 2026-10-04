package kz.company.shop.mks;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.Optional;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.roles.entity.Role;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import org.junit.jupiter.api.Test;

class MksAccessTest {
    private final AuthContext auth = mock(AuthContext.class);
    private final UserRepository users = mock(UserRepository.class);
    private final MksAccess access = new MksAccess(auth, users);

    private User user() {
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                7L,
                                null,
                                null,
                                null,
                                java.util.Set.of("pages.mks.view"),
                                true,
                                null));
        var user = new User();
        user.id = 7L;
        when(users.findById(7L)).thenReturn(Optional.of(user));
        return user;
    }

    @Test
    void allowsSeniorSellerWithPagePermission() {
        var user = user();
        var role = new Role();
        role.code = "senior_seller";
        user.roles.add(role);
        access.requireCatalogAccess();
        verify(auth).require("pages.mks.view");
    }

    @Test
    void allowsDirectPermissionHolderWithoutRoles() {
        user();
        access.requireCatalogAccess();
        verify(auth).require("pages.mks.view");
    }

    @Test
    void allowsActiveAdministratorAndRequiresPagePermission() {
        var user = user();
        var role = new Role();
        role.code = "administrator";
        user.roles.add(role);
        access.requireCatalogAccess();
        verify(auth).require("pages.mks.view");
    }

    @Test
    void rejectsUsersWithoutPagePermissionBeforeLookingUpUser() {
        doThrow(new AppExceptions.Forbidden("pages.mks.view")).when(auth).require("pages.mks.view");
        assertThatThrownBy(access::requireCatalogAccess)
                .isInstanceOf(AppExceptions.Forbidden.class);
        verifyNoInteractions(users);
    }

    @Test
    void rejectsMissingUserEvenIfTokenStillGrantsPermission() {
        user();
        when(users.findById(7L)).thenReturn(Optional.empty());
        assertThatThrownBy(access::requireCatalogAccess)
                .isInstanceOf(AppExceptions.Forbidden.class);
    }

    @Test
    void rejectsDeletedAndInactiveUsersEvenIfTokenStillGrantsPermission() {
        var user = user();
        var role = new Role();
        role.code = "administrator";
        user.roles.add(role);
        user.deletedAt = Instant.now();
        assertThatThrownBy(access::requireCatalogAccess)
                .isInstanceOf(AppExceptions.Forbidden.class);
        user.deletedAt = null;
        user.active = false;
        assertThatThrownBy(access::requireCatalogAccess)
                .isInstanceOf(AppExceptions.Forbidden.class);
    }
}
