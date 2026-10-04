package kz.company.shop.warehouse.ai;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "ai_price_sessions")
public class AiPriceSession {
    @Id public UUID id;
    @Column(name = "receipt_id", nullable = false) public UUID receiptId;
    @Column(name = "parent_session_id") public UUID parentSessionId;
    @Column(name = "group_id", nullable = false) public UUID groupId;
    @Column(name = "group_name", nullable = false) public String groupName;
    @Column(name = "group_rules_snapshot", columnDefinition = "text") public String groupRulesSnapshot;
    @Column(name = "group_comment_snapshot", columnDefinition = "text") public String groupCommentSnapshot;
    @Column(name = "source_document_date") public LocalDate sourceDocumentDate;
    @Column(nullable = false) public String status;
    @Column(name = "assistant_message", columnDefinition = "text") public String assistantMessage;
    @Column(name = "questions_json", nullable = false, columnDefinition = "text") public String questionsJson = "[]";
    @Column(name = "messages_json", nullable = false, columnDefinition = "text") public String messagesJson = "[]";
    @Column(name = "rows_json", nullable = false, columnDefinition = "text") public String rowsJson = "[]";
    @Column(name = "created_document_ids_json", nullable = false, columnDefinition = "text") public String createdDocumentIdsJson = "[]";
    @Column(name = "created_by_user_id", nullable = false) public Long createdByUserId;
    @Column(name = "created_at", nullable = false) public Instant createdAt = Instant.now();
    @Column(name = "updated_at", nullable = false) public Instant updatedAt = Instant.now();
    @PreUpdate void touch() { updatedAt = Instant.now(); }
}
