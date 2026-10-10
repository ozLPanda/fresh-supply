package kz.company.shop.users.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import kz.company.shop.auth.repository.AuthSessionRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.common.validation.PhoneNumbers;
import kz.company.shop.orders.service.PendingOrderCustomerBindingService;
import kz.company.shop.permissions.repository.PermissionRepository;
import kz.company.shop.roles.entity.Role;
import kz.company.shop.roles.repository.RoleRepository;
import kz.company.shop.users.dto.ProfileUpdateRequest;
import kz.company.shop.users.dto.OrderSettingsDto;
import kz.company.shop.users.dto.OrderSettingsUpdateRequest;
import kz.company.shop.users.dto.UserCreateRequest;
import kz.company.shop.users.dto.UserDto;
import kz.company.shop.users.dto.UserPasswordUpdateRequest;
import kz.company.shop.users.dto.UserRolesUpdateRequest;
import kz.company.shop.users.dto.UserUpdateRequest;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.wallets.service.WalletService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final PasswordEncoder encoder;
    private final WalletService walletService;
    private final PendingOrderCustomerBindingService pendingOrderCustomerBindingService;
    private final AuthSessionRepository authSessions;

    public UserService(
            UserRepository userRepository,
            RoleRepository roleRepository,
            PermissionRepository permissionRepository,
            PasswordEncoder encoder,
            WalletService walletService,
            PendingOrderCustomerBindingService pendingOrderCustomerBindingService,
            AuthSessionRepository authSessions) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.encoder = encoder;
        this.walletService = walletService;
        this.pendingOrderCustomerBindingService = pendingOrderCustomerBindingService;
        this.authSessions = authSessions;
    }

    public List<UserDto> list() {
        return userRepository.findAll().stream()
                .filter(user -> user.deletedAt == null)
                .map(this::toDto)
                .toList();
    }

    public List<UserDto> listActiveWithPermission(String permission) {
        return userRepository.findActiveWithPermission(permission).stream()
                .map(this::toDto)
                .toList();
    }

    public User activeWithPermission(Long id, String permission, String assignmentLabel) {
        User user = byId(id);
        if (!user.active) throw new AppExceptions.BadRequest("Ответственный пользователь отключён");
        if (!effectivePermissions(user).contains(permission)) {
            throw new AppExceptions.BadRequest(
                    "У пользователя нет права для назначения: " + assignmentLabel);
        }
        return user;
    }

    public User byPhone(String phone) {
        return userRepository
                .findByPhoneAndDeletedAtIsNull(normalizePhone(phone))
                .orElseThrow(
                        () -> new AppExceptions.BadRequest("Неверный номер телефона или пароль"));
    }

    public User byId(Long id) {
        return userRepository
                .findById(id)
                .filter(user -> user.deletedAt == null)
                .orElseThrow(() -> new AppExceptions.NotFound("Пользователь не найден"));
    }

    public CurrentUser currentUser(Long id) {
        User user = byId(id);
        if (!user.active) {
            throw new AppExceptions.BadRequest("Учётная запись отключена");
        }
        Set<String> permissions = effectivePermissions(user);
        boolean adminAccess =
                user.roles.stream()
                                .anyMatch(role -> role.active && "administrator".equals(role.code))
                        || permissions.stream().anyMatch(code -> code.startsWith("pages."));
        return new CurrentUser(
                user.id,
                user.email,
                user.name,
                user.phone,
                permissions,
                adminAccess,
                walletService.balance(user.id),
                user.personalDiscountPercent);
    }

    @Transactional
    public UserDto create(UserCreateRequest request, Long actorId) {
        String email = normalizeEmail(request.email());
        String phone = normalizePhone(request.phone());
        if (email != null && userRepository.existsByEmail(email)) {
            throw new AppExceptions.BadRequest("Email уже используется");
        }
        if (userRepository.existsByPhone(phone)) {
            throw new AppExceptions.BadRequest("Номер телефона уже используется");
        }
        Set<Long> roleIds = request.roleIds() == null ? Set.of() : request.roleIds();
        List<Role> roles = roleRepository.findByIdIn(roleIds);
        if (roles.size() != roleIds.size()) {
            throw new AppExceptions.BadRequest("Одна или несколько ролей не найдены");
        }
        ensureRolesActive(roles);
        if (!roles.isEmpty()) {
            requireAdministrator(actorId);
        }
        User user = new User();
        user.name = request.name().trim();
        user.email = email;
        user.phone = phone;
        user.active = request.active() == null || request.active();
        user.personalDiscountPercent = normalizePersonalDiscount(request.personalDiscountPercent());
        user.roles = new HashSet<>(roles);
        user.passwordHash = encoder.encode(request.password());
        User saved = userRepository.save(user);
        walletService.ensure(saved.id);
        pendingOrderCustomerBindingService.bindRegisteredUser(saved);
        return toDto(saved);
    }

    @Transactional
    public User register(String name, String email, String phone, String password) {
        String normalizedEmail = normalizeEmail(email);
        String normalizedPhone = normalizePhone(phone);
        if (normalizedEmail != null && userRepository.existsByEmail(normalizedEmail)) {
            throw new AppExceptions.BadRequest("Email уже используется");
        }
        if (userRepository.existsByPhone(normalizedPhone)) {
            throw new AppExceptions.BadRequest("Номер телефона уже используется");
        }
        User user = new User();
        user.name = name.trim();
        user.email = normalizedEmail;
        user.phone = normalizedPhone;
        user.passwordHash = encoder.encode(password);
        User saved = userRepository.save(user);
        walletService.ensure(saved.id);
        pendingOrderCustomerBindingService.bindRegisteredUser(saved);
        return saved;
    }

    @Transactional
    public CurrentUser updateProfile(Long id, ProfileUpdateRequest request) {
        User user = byId(id);
        user.name = request.name().trim();
        String phone = normalizePhone(request.phone());
        if (!phone.equals(user.phone) && userRepository.existsByPhone(phone)) {
            throw new AppExceptions.BadRequest("Номер телефона уже используется");
        }
        user.phone = phone;
        User saved = userRepository.save(user);
        pendingOrderCustomerBindingService.bindRegisteredUser(saved);
        return currentUser(id);
    }

    public OrderSettingsDto orderSettings(Long id) {
        return new OrderSettingsDto(byId(id).orderInvoiceTemplate);
    }

    @Transactional
    public OrderSettingsDto updateOrderSettings(Long id, OrderSettingsUpdateRequest request) {
        User user = byId(id);
        user.orderInvoiceTemplate = request.invoiceTemplate() == null ? "" : request.invoiceTemplate().trim();
        return new OrderSettingsDto(userRepository.save(user).orderInvoiceTemplate);
    }

    @Transactional
    public UserDto update(Long id, UserUpdateRequest request) {
        User user = byId(id);
        String email = normalizeEmail(request.email());
        String phone = normalizePhone(request.phone());
        if (email != null && !email.equals(user.email) && userRepository.existsByEmail(email)) {
            throw new AppExceptions.BadRequest("Email уже используется");
        }
        if (!phone.equals(user.phone) && userRepository.existsByPhone(phone)) {
            throw new AppExceptions.BadRequest("Номер телефона уже используется");
        }
        user.name = request.name().trim();
        user.email = email;
        user.phone = phone;
        boolean wasActive = user.active;
        user.active = request.active() == null || request.active();
        user.personalDiscountPercent = normalizePersonalDiscount(request.personalDiscountPercent());
        if (wasActive && !user.active && isAdministrator(user) && isLastActiveAdministrator()) {
            throw new AppExceptions.BadRequest("Нельзя отключить последнего администратора");
        }
        User saved = userRepository.save(user);
        pendingOrderCustomerBindingService.bindRegisteredUser(saved);
        if (wasActive && !saved.active) {
            authSessions.revokeActiveByUserId(saved.id, Instant.now());
        }
        return toDto(saved);
    }

    @Transactional
    public UserDto updatePassword(Long id, UserPasswordUpdateRequest request) {
        User user = byId(id);
        user.passwordHash = encoder.encode(request.newPassword());
        User saved = userRepository.save(user);
        authSessions.revokeActiveByUserId(user.id, Instant.now());
        return toDto(saved);
    }

    public boolean passwordMatches(User user, String password) {
        return user.active && encoder.matches(password, user.passwordHash);
    }

    public Set<String> effectivePermissions(User user) {
        Set<String> result = user.permissions.stream().map(p -> p.code).collect(Collectors.toSet());
        user.roles.stream()
                .filter(role -> role.active)
                .forEach(
                        role ->
                                role.permissions.forEach(
                                        permission -> result.add(permission.code)));
        return result;
    }

    public UserDto toDto(User user) {
        return new UserDto(
                user.id,
                user.name,
                user.email,
                user.phone,
                user.active,
                user.personalDiscountPercent,
                null,
                user.roles.stream().map(role -> role.id).collect(Collectors.toSet()),
                user.permissions.stream()
                        .map(permission -> permission.id)
                        .collect(Collectors.toSet()),
                effectivePermissions(user));
    }

    public void delete(Long id) {
        User user = byId(id);
        if (user.active && isAdministrator(user) && isLastActiveAdministrator()) {
            throw new AppExceptions.BadRequest("Нельзя удалить последнего администратора");
        }
        userRepository.deleteById(id);
    }

    @Transactional
    public UserDto updateRoles(Long id, UserRolesUpdateRequest request, Long actorId) {
        User user = byId(id);
        requireAdministrator(actorId);
        Set<Long> roleIds = request.roleIds() == null ? Set.of() : request.roleIds();
        List<Role> roles = roleRepository.findByIdIn(roleIds);
        if (roles.size() != roleIds.size()) {
            throw new AppExceptions.BadRequest("Одна или несколько ролей не найдены");
        }
        ensureRolesActive(roles);
        boolean removesAdministrator =
                isAdministrator(user) && roles.stream().noneMatch(this::isAdministrator);
        if (user.active && removesAdministrator && isLastActiveAdministrator()) {
            throw new AppExceptions.BadRequest("Нельзя снять роль у последнего администратора");
        }
        user.roles = new HashSet<>(roles);
        return toDto(userRepository.save(user));
    }

    private void ensureRolesActive(List<Role> roles) {
        if (roles.stream().anyMatch(role -> !role.active)) {
            throw new AppExceptions.BadRequest("Нельзя назначить отключенную роль");
        }
    }

    private boolean isAdministrator(User user) {
        return user.roles.stream().anyMatch(this::isAdministrator);
    }

    public boolean isAdministrator(Long userId) {
        return isAdministrator(byId(userId));
    }

    private void requireAdministrator(Long actorId) {
        if (!isAdministrator(actorId)) {
            throw new AppExceptions.Forbidden("administrator");
        }
    }

    private boolean isAdministrator(Role role) {
        return "administrator".equals(role.code);
    }

    private boolean isLastActiveAdministrator() {
        return userRepository.countActiveByRoleCode("administrator") <= 1;
    }

    private String normalizeEmail(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim().toLowerCase();
    }

    private BigDecimal normalizePersonalDiscount(BigDecimal value) {
        if (value == null) return BigDecimal.ZERO;
        if (value.compareTo(BigDecimal.ZERO) < 0 || value.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new AppExceptions.BadRequest("Размер скидки должен быть от 0 до 100%");
        }
        return value;
    }

    private String normalizePhone(String value) {
        return PhoneNumbers.normalize(value);
    }
}
