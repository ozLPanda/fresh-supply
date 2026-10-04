package kz.company.shop.regularbuyers.service;

import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import kz.company.shop.regularbuyers.RegularBuyerAliases;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import kz.company.shop.regularbuyers.repository.RegularBuyerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Appends an explicitly approved shared alias; callers must check regular-buyers.manage. */
@Service
public class RegularBuyerAliasLearningService {
    public enum Status {
        ADDED,
        ALREADY_PRESENT,
        CONFLICT,
        LIMIT_REACHED,
        ARCHIVED,
        NOT_FOUND,
        INVALID
    }

    public record Result(Status status, String officialName) {}

    private final RegularBuyerRepository repository;
    private final EntityManager entityManager;

    public RegularBuyerAliasLearningService(
            RegularBuyerRepository repository, EntityManager entityManager) {
        this.repository = repository;
        this.entityManager = entityManager;
    }

    @Transactional
    public Result append(UUID buyerId, String alias) {
        String display = RegularBuyerAliases.display(alias);
        if (buyerId == null
                || display == null
                || display.isEmpty()
                || display.length() > RegularBuyerAliases.MAX_LENGTH) {
            return new Result(Status.INVALID, null);
        }
        // Always lock the active directory in the same order before considering the target.
        // This serializes simultaneous learning calls for different buyers. Manual directory
        // edits may intentionally introduce duplicate aliases and retain their existing behavior.
        List<RegularBuyer> active = repository.findActiveForUpdateOrdered();
        // The outer chat transaction may have loaded these aliases before a slow model call.
        // Refresh after locking so an overlapping approval cannot overwrite an earlier append.
        // The caller must not have pending edits to buyer entities in this transaction.
        active.forEach(entityManager::refresh);
        RegularBuyer target =
                active.stream()
                        .filter(b -> buyerId.equals(b.id))
                        .findFirst()
                        .orElseGet(() -> repository.findForUpdateById(buyerId).orElse(null));
        if (target == null) return new Result(Status.NOT_FOUND, null);
        if (active.stream().noneMatch(b -> buyerId.equals(b.id))) entityManager.refresh(target);
        if (target.archived) return new Result(Status.ARCHIVED, target.name);
        String key = RegularBuyerAliases.key(display);
        boolean conflict =
                active.stream().filter(b -> !buyerId.equals(b.id)).anyMatch(b -> matches(b, key));
        if (conflict) return new Result(Status.CONFLICT, target.name);
        if (matches(target, key)) return new Result(Status.ALREADY_PRESENT, target.name);
        if (target.aliases != null && target.aliases.size() >= RegularBuyerAliases.MAX_ALIASES) {
            return new Result(Status.LIMIT_REACHED, target.name);
        }
        if (target.aliases == null) target.aliases = new ArrayList<>();
        target.aliases.add(display);
        target.updatedAt = Instant.now();
        repository.save(target);
        return new Result(Status.ADDED, target.name);
    }

    private boolean matches(RegularBuyer buyer, String key) {
        return RegularBuyerAliases.key(buyer.name).equals(key)
                || (buyer.aliases != null
                        && buyer.aliases.stream()
                                .anyMatch(alias -> RegularBuyerAliases.key(alias).equals(key)));
    }
}
