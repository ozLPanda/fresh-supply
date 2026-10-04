package kz.company.shop.users.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import kz.company.shop.auth.repository.AuthSessionRepository;
import kz.company.shop.orders.service.PendingOrderCustomerBindingService;
import kz.company.shop.permissions.repository.PermissionRepository;
import kz.company.shop.roles.entity.Role;
import kz.company.shop.roles.repository.RoleRepository;
import kz.company.shop.users.dto.UserCreateRequest;
import kz.company.shop.users.dto.UserPasswordUpdateRequest;
import kz.company.shop.users.dto.UserRolesUpdateRequest;
import kz.company.shop.users.dto.UserUpdateRequest;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.wallets.service.WalletService;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

class UserServiceTest {

    private final UserRepository users = org.mockito.Mockito.mock(UserRepository.class);
    private final RoleRepository roles = org.mockito.Mockito.mock(RoleRepository.class);
    private final PermissionRepository permissions =
            org.mockito.Mockito.mock(PermissionRepository.class);
    private final PasswordEncoder encoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    private final WalletService wallets = org.mockito.Mockito.mock(WalletService.class);
    private final PendingOrderCustomerBindingService pendingOrders =
            org.mockito.Mockito.mock(PendingOrderCustomerBindingService.class);
    private final AuthSessionRepository sessions =
            org.mockito.Mockito.mock(AuthSessionRepository.class);
    private final UserService service =
            new UserService(users, roles, permissions, encoder, wallets, pendingOrders, sessions);

    @Test
    void registersWithPhoneAndWithoutEmail() {
        when(users.existsByPhone("+77771234567")).thenReturn(false);
        when(encoder.encode("password1")).thenReturn("hash");
        when(users.save(any(User.class)))
                .thenAnswer(
                        invocation -> {
                            User user = invocation.getArgument(0);
                            user.id = 42L;
                            return user;
                        });

        User user = service.register(" Клиент ", " ", "8 777 123 45 67", "password1");

        assertThat(user.name).isEqualTo("Клиент");
        assertThat(user.email).isNull();
        assertThat(user.phone).isEqualTo("+77771234567");
        assertThat(user.passwordHash).isEqualTo("hash");
        verify(wallets).ensure(42L);
        verify(pendingOrders).bindRegisteredUser(user);
    }

    @Test
    void findsUserByNormalizedPhone() {
        User user = new User();
        user.phone = "+77771234567";
        when(users.findByPhoneAndDeletedAtIsNull("+77771234567"))
                .thenReturn(java.util.Optional.of(user));

        assertThat(service.byPhone("7771234567")).isSameAs(user);
    }

    @Test
    void updatesPasswordWithEncoderAndRevokesExistingSessions() {
        User user = new User();
        user.id = 7L;
        user.name = "Пользователь";
        user.phone = "+77771234567";
        user.passwordHash = "old-hash";
        when(users.findById(7L)).thenReturn(java.util.Optional.of(user));
        when(encoder.encode("new-password")).thenReturn("new-hash");
        when(users.save(user)).thenReturn(user);

        service.updatePassword(7L, new UserPasswordUpdateRequest("new-password"));

        assertThat(user.passwordHash).isEqualTo("new-hash");
        verify(sessions).revokeActiveByUserId(org.mockito.ArgumentMatchers.eq(7L), any());
    }

    @Test
    void preventsDisablingLastAdministrator() {
        Role administrator = new Role();
        administrator.code = "administrator";
        User user = new User();
        user.id = 7L;
        user.name = "Администратор";
        user.email = "admin@example.com";
        user.phone = "+77771234567";
        user.roles.add(administrator);
        when(users.findById(7L)).thenReturn(java.util.Optional.of(user));
        when(users.countActiveByRoleCode("administrator")).thenReturn(1L);

        assertThatThrownBy(
                        () ->
                                service.update(
                                        7L,
                                        new UserUpdateRequest(
                                                "Администратор",
                                                "admin@example.com",
                                                "+77771234567",
                                                false,
                                                java.math.BigDecimal.ZERO)))
                .hasMessage("Нельзя отключить последнего администратора");
    }

    @Test
    void preventsNonAdministratorFromCreatingUserWithRoles() {
        Role seller = new Role();
        seller.id = 4L;
        seller.code = "seller";
        User actor = new User();
        actor.id = 7L;
        actor.roles = new java.util.HashSet<>();
        when(roles.findByIdIn(java.util.Set.of(4L))).thenReturn(java.util.List.of(seller));
        when(users.findById(7L)).thenReturn(java.util.Optional.of(actor));

        assertThatThrownBy(
                        () ->
                                service.create(
                                        new UserCreateRequest(
                                                "Seller",
                                                "seller@example.com",
                                                "+77771234567",
                                                "password1",
                                                true,
                                                java.util.Set.of(4L),
                                                java.math.BigDecimal.ZERO),
                                        7L))
                .hasMessageContaining("administrator");
    }

    @Test
    void allowsAdministratorToCreateUserWithRoles() {
        Role administrator = new Role();
        administrator.code = "administrator";
        Role seller = new Role();
        seller.id = 4L;
        seller.code = "seller";
        User actor = new User();
        actor.id = 7L;
        actor.roles.add(administrator);
        when(users.findById(7L)).thenReturn(java.util.Optional.of(actor));
        when(roles.findByIdIn(java.util.Set.of(4L))).thenReturn(java.util.List.of(seller));
        when(users.existsByEmail("seller@example.com")).thenReturn(false);
        when(users.existsByPhone("+77771234567")).thenReturn(false);
        when(encoder.encode("password1")).thenReturn("hash");
        when(users.save(any(User.class)))
                .thenAnswer(
                        invocation -> {
                            User user = invocation.getArgument(0);
                            user.id = 42L;
                            return user;
                        });

        var created =
                service.create(
                        new UserCreateRequest(
                                "Seller",
                                "seller@example.com",
                                "+77771234567",
                                "password1",
                                true,
                                java.util.Set.of(4L),
                                java.math.BigDecimal.ZERO),
                        7L);

        assertThat(created.id()).isEqualTo(42L);
        verify(wallets).ensure(42L);
    }

    @Test
    void preventsNonAdministratorFromUpdatingRoles() {
        User target = new User();
        target.id = 8L;
        User actor = new User();
        actor.id = 7L;
        when(users.findById(8L)).thenReturn(java.util.Optional.of(target));
        when(users.findById(7L)).thenReturn(java.util.Optional.of(actor));

        assertThatThrownBy(
                        () ->
                                service.updateRoles(
                                        8L, new UserRolesUpdateRequest(java.util.Set.of()), 7L))
                .hasMessageContaining("administrator");
    }
}
