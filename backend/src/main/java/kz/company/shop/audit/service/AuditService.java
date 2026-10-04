package kz.company.shop.audit.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import kz.company.shop.audit.entity.AuditLog;
import kz.company.shop.audit.repository.AuditLogRepository;
import kz.company.shop.common.security.AuthContext;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
    private final AuditLogRepository repository;
    private final AuthContext auth;
    private final ObjectMapper objectMapper;

    public AuditService(AuditLogRepository repository, AuthContext auth, ObjectMapper objectMapper) {
        this.repository = repository;
        this.auth = auth;
        this.objectMapper = objectMapper;
    }

    public void record(String action, String entityType, Object entityId, String description) {
        var actor = auth.optional();
        AuditLog log = new AuditLog();
        log.actorUserId = actor.map(user -> user.id()).orElse(null);
        log.actorName = actor.map(user -> user.name()).orElse("System");
        log.action = action;
        log.entityType = entityType;
        log.entityId = entityId == null ? null : entityId.toString();
        log.description = description;
        repository.save(log);
    }

    public void record(
            String action, String entityType, Object entityId, String description, Object details) {
        var actor = auth.optional();
        AuditLog log = new AuditLog();
        log.actorUserId = actor.map(user -> user.id()).orElse(null);
        log.actorName = actor.map(user -> user.name()).orElse("System");
        log.action = action;
        log.entityType = entityType;
        log.entityId = entityId == null ? null : entityId.toString();
        log.description = description;
        try {
            log.details = objectMapper.writeValueAsString(details);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Не удалось сохранить детали действия", error);
        }
        repository.save(log);
    }
}
