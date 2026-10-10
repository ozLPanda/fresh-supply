package kz.company.shop.auth.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import java.util.Optional;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

class SeedAdminCredentialRotatorTest {
    private final UserRepository repository = mock(UserRepository.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);

    @Test
    void disabledGuardDoesNotReadOrChangeAdmin() {
        new SeedAdminCredentialRotator(repository, encoder, false, "").run(null);

        verifyNoInteractions(repository, encoder);
    }

    @Test
    void alreadyRotatedAdminDoesNotRequireBootstrapSecret() {
        User user = seedAdmin();
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(false);

        new SeedAdminCredentialRotator(repository, encoder, true, "").run(null);

        verify(repository, never()).save(any());
    }

    @Test
    void knownCredentialFailsStartupWithoutStrongBootstrapSecret() {
        User user = seedAdmin();
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(true);

        assertThatThrownBy(
                        () ->
                                new SeedAdminCredentialRotator(repository, encoder, true, "short")
                                        .run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("APP_BOOTSTRAP_ADMIN_PASSWORD");

        verify(repository, never()).save(any());
    }

    @Test
    void knownCredentialIsRotatedToConfiguredSecret() {
        User user = seedAdmin();
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(true);
        when(encoder.encode("a-strong-bootstrap-password")).thenReturn("rotated-hash");

        new SeedAdminCredentialRotator(repository, encoder, true, "a-strong-bootstrap-password")
                .run(null);

        verify(repository).save(user);
        org.assertj.core.api.Assertions.assertThat(user.passwordHash).isEqualTo("rotated-hash");
    }

    @Test
    void firstDesktopBootstrapNormalizesPhoneAndRotatesPasswordTogether() {
        User user = seedAdmin();
        user.phone = "+70000000002";
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(true);
        when(encoder.encode("a-strong-bootstrap-password")).thenReturn("rotated-hash");
        new SeedAdminCredentialRotator(
                        repository,
                        encoder,
                        true,
                        "a-strong-bootstrap-password",
                        new org.springframework.mock.env.MockEnvironment()
                                .withProperty("spring.profiles.active", "desktop"),
                        "8 (000) 000-00-01")
                .run(null);
        org.assertj.core.api.Assertions.assertThat(user.phone).isEqualTo("+70000000001");
        org.assertj.core.api.Assertions.assertThat(user.passwordHash).isEqualTo("rotated-hash");
        verify(repository).save(user);
    }

    @Test
    void desktopRestartWithCustomPasswordPreservesPhoneAndPassword() {
        User user = seedAdmin();
        user.phone = "+70000000002";
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(false);
        new SeedAdminCredentialRotator(
                        repository,
                        encoder,
                        true,
                        "a-strong-bootstrap-password",
                        new org.springframework.mock.env.MockEnvironment()
                                .withProperty("spring.profiles.active", "desktop"),
                        "+70000000001")
                .run(null);
        org.assertj.core.api.Assertions.assertThat(user.phone).isEqualTo("+70000000002");
        org.assertj.core.api.Assertions.assertThat(user.passwordHash).isEqualTo("known-hash");
        verify(repository, never()).save(any());
    }

    @Test
    void productionBootstrapDoesNotApplyDesktopPhone() {
        User user = seedAdmin();
        user.phone = "+70000000002";
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(true);
        new SeedAdminCredentialRotator(
                        repository,
                        encoder,
                        true,
                        "a-strong-bootstrap-password",
                        new org.springframework.mock.env.MockEnvironment(),
                        "+70000000001")
                .run(null);
        org.assertj.core.api.Assertions.assertThat(user.phone).isEqualTo("+70000000002");
        verify(repository).save(user);
    }

    @Test
    void invalidBootstrapPasswordCannotChangePhone() {
        User user = seedAdmin();
        user.phone = "+70000000002";
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(true);
        assertThatThrownBy(
                        () ->
                                new SeedAdminCredentialRotator(
                                                repository,
                                                encoder,
                                                true,
                                                "short",
                                                new org.springframework.mock.env.MockEnvironment()
                                                        .withProperty(
                                                                "spring.profiles.active",
                                                                "desktop"),
                                                "+70000000001")
                                        .run(null))
                .isInstanceOf(IllegalStateException.class);
        org.assertj.core.api.Assertions.assertThat(user.phone).isEqualTo("+70000000002");
        verify(repository, never()).save(any());
    }

    @Test
    void trustedDesktopImportRetainsSourcePasswordAndPhone() {
        new SeedAdminCredentialRotator(
                        repository,
                        encoder,
                        true,
                        "",
                        new org.springframework.mock.env.MockEnvironment()
                                .withProperty("spring.profiles.active", "desktop"),
                        "+70000000001",
                        true)
                .run(null);
        verifyNoInteractions(repository, encoder);
    }

    @Test
    void importedFlagCannotDisableProductionCredentialGuard() {
        User user = seedAdmin();
        when(repository.findByEmailAndDeletedAtIsNull("admin@active.kz"))
                .thenReturn(Optional.of(user));
        when(encoder.matches("password", user.passwordHash)).thenReturn(true);
        assertThatThrownBy(
                        () ->
                                new SeedAdminCredentialRotator(
                                                repository,
                                                encoder,
                                                true,
                                                "",
                                                new org.springframework.mock.env.MockEnvironment(),
                                                "+70000000001",
                                                true)
                                        .run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("APP_BOOTSTRAP_ADMIN_PASSWORD");
        verify(repository, never()).save(any());
    }

    private User seedAdmin() {
        User user = new User();
        user.email = "admin@active.kz";
        user.passwordHash = "known-hash";
        return user;
    }
}
