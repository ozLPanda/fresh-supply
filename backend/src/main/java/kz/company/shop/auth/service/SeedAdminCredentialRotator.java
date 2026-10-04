package kz.company.shop.auth.service;

import kz.company.shop.users.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class SeedAdminCredentialRotator implements ApplicationRunner {
    static final String SEED_ADMIN_EMAIL = "admin@active.kz";
    static final String KNOWN_SEED_PASSWORD = "password";

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final boolean enabled;
    private final String bootstrapPassword;

    public SeedAdminCredentialRotator(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            @Value("${app.auth.rotate-seed-admin}") boolean enabled,
            @Value("${app.auth.bootstrap-admin-password:}") String bootstrapPassword) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.enabled = enabled;
        this.bootstrapPassword = bootstrapPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            return;
        }
        userRepository
                .findByEmailAndDeletedAtIsNull(SEED_ADMIN_EMAIL)
                .filter(user -> passwordEncoder.matches(KNOWN_SEED_PASSWORD, user.passwordHash))
                .ifPresent(
                        user -> {
                            if (bootstrapPassword.length() < 16
                                    || KNOWN_SEED_PASSWORD.equals(bootstrapPassword)) {
                                throw new IllegalStateException(
                                        "APP_BOOTSTRAP_ADMIN_PASSWORD must contain at least 16 "
                                                + "characters when the known seed admin credential "
                                                + "is still active");
                            }
                            user.passwordHash = passwordEncoder.encode(bootstrapPassword);
                            userRepository.save(user);
                        });
    }
}
