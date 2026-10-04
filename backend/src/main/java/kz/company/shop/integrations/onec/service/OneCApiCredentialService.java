package kz.company.shop.integrations.onec.service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.integrations.onec.dto.OneCApiCredentialDto;
import kz.company.shop.integrations.onec.dto.OneCApiCredentialRequest;
import kz.company.shop.integrations.onec.entity.ExternalApiCredential;
import kz.company.shop.integrations.onec.repository.ExternalApiCredentialRepository;
import kz.company.shop.permissions.entity.Permission;
import kz.company.shop.permissions.repository.PermissionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OneCApiCredentialService {
    private static final SecureRandom TOKEN_RANDOM = new SecureRandom();
    private static final Base64.Encoder TOKEN_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Set<String> SUPPORTED_PERMISSIONS = Set.of("orders.read");

    private final ExternalApiCredentialRepository credentials;
    private final PermissionRepository permissions;

    public OneCApiCredentialService(
            ExternalApiCredentialRepository credentials, PermissionRepository permissions) {
        this.credentials = credentials;
        this.permissions = permissions;
    }

    @Transactional(readOnly = true)
    public List<OneCApiCredentialDto> list() {
        return credentials.findAll().stream()
                .sorted(
                        Comparator.comparing(
                                        (ExternalApiCredential credential) -> credential.createdAt)
                                .reversed())
                .map(this::toDto)
                .toList();
    }

    @Transactional
    public OneCApiCredentialDto create(OneCApiCredentialRequest request) {
        ExternalApiCredential credential = new ExternalApiCredential();
        credential.accessCode = nextAccessCode();
        apply(credential, request);
        return toDto(credentials.save(credential));
    }

    @Transactional
    public OneCApiCredentialDto update(Long id, OneCApiCredentialRequest request) {
        ExternalApiCredential credential = get(id);
        if (credential.revokedAt != null) {
            throw new AppExceptions.BadRequest("Отозванный код доступа нельзя изменить");
        }
        apply(credential, request);
        return toDto(credentials.save(credential));
    }

    @Transactional
    public OneCApiCredentialDto revoke(Long id) {
        ExternalApiCredential credential = get(id);
        if (credential.revokedAt == null) {
            credential.revokedAt = Instant.now();
            credential.updatedAt = credential.revokedAt;
        }
        return toDto(credentials.save(credential));
    }

    private void apply(ExternalApiCredential credential, OneCApiCredentialRequest request) {
        Set<Permission> requestedPermissions = resolvePermissions(request.permissions());
        credential.name = request.name().trim();
        credential.permissions = requestedPermissions;
        credential.expiresAt = request.expiresAt();
        credential.updatedAt = Instant.now();
    }

    private Set<Permission> resolvePermissions(Set<String> permissionCodes) {
        if (!SUPPORTED_PERMISSIONS.containsAll(permissionCodes)) {
            throw new AppExceptions.BadRequest(
                    "Передано неподдерживаемое разрешение для внешнего API");
        }
        List<Permission> found = permissions.findByCodeIn(permissionCodes);
        if (found.size() != permissionCodes.size()) {
            throw new AppExceptions.BadRequest("Одно или несколько разрешений не найдены");
        }
        return new LinkedHashSet<>(found);
    }

    private ExternalApiCredential get(Long id) {
        return credentials
                .findById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Код доступа не найден"));
    }

    private String nextAccessCode() {
        byte[] bytes = new byte[32];
        String code;
        do {
            TOKEN_RANDOM.nextBytes(bytes);
            code = "csk_" + TOKEN_ENCODER.encodeToString(bytes);
        } while (credentials.existsByAccessCode(code));
        return code;
    }

    private OneCApiCredentialDto toDto(ExternalApiCredential credential) {
        return new OneCApiCredentialDto(
                credential.id.toString(),
                credential.name,
                credential.accessCode,
                credential.permissions.stream()
                        .map(permission -> permission.code)
                        .sorted()
                        .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new)),
                credential.expiresAt,
                credential.revokedAt,
                credential.createdAt,
                credential.updatedAt);
    }
}
