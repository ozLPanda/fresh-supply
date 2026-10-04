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

    private User seedAdmin() {
        User user = new User();
        user.email = "admin@active.kz";
        user.passwordHash = "known-hash";
        return user;
    }
}
