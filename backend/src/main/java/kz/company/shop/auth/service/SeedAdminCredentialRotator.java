package kz.company.shop.auth.service;

import kz.company.shop.common.validation.PhoneNumbers;
import kz.company.shop.users.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
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
    private final boolean desktop;
    private final String bootstrapPhone;
    private final boolean importedData;

    public SeedAdminCredentialRotator(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            boolean enabled,
            String bootstrapPassword) {
        this(
                userRepository,
                passwordEncoder,
                enabled,
                bootstrapPassword,
                new org.springframework.core.env.StandardEnvironment(),
                "");
    }

    public SeedAdminCredentialRotator(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            boolean enabled,
            String bootstrapPassword,
            Environment environment,
            String bootstrapPhone) {
        this(
                userRepository,
                passwordEncoder,
                enabled,
                bootstrapPassword,
                environment,
                bootstrapPhone,
                false);
    }

    @Autowired
    public SeedAdminCredentialRotator(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            @Value("${app.auth.rotate-seed-admin}") boolean enabled,
            @Value("${app.auth.bootstrap-admin-password:}") String bootstrapPassword,
            Environment environment,
            @Value("${app.desktop.admin-phone:}") String bootstrapPhone,
            @Value("${app.desktop.imported-data:false}") boolean importedData) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.enabled = enabled;
        this.bootstrapPassword = bootstrapPassword;
        this.desktop = environment.acceptsProfiles(Profiles.of("desktop"));
        this.bootstrapPhone = bootstrapPhone;
        this.importedData = importedData;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled || desktop && importedData) {
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
                            if (desktop && !bootstrapPhone.isBlank()) {
                                String normalized = PhoneNumbers.normalize(bootstrapPhone);
                                if (!normalized.equals(user.phone)
                                        && userRepository.existsByPhone(normalized)) {
                                    throw new IllegalStateException(
                                            "Desktop admin phone is already in use");
                                }
                                user.phone = normalized;
                            }
                            user.passwordHash = passwordEncoder.encode(bootstrapPassword);
                            userRepository.save(user);
                        });
    }
}
