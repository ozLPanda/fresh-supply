package kz.company.shop.whatsapp;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;

@Repository
public class WhatsAppInboxRepository {
    private final JdbcTemplate jdbc;

    public WhatsAppInboxRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void saveIncoming(IncomingWhatsAppMessage message) {
        Long contactId = jdbc.queryForObject(
                """
                insert into whatsapp_contacts (wa_id, display_name)
                values (?, ?)
                on conflict (wa_id) do update set
                    display_name = coalesce(excluded.display_name, whatsapp_contacts.display_name),
                    updated_at = now()
                returning id
                """,
                Long.class,
                message.waId(),
                truncate(message.displayName(), 255));
        int inserted = jdbc.update(
                """
                insert into whatsapp_messages
                    (contact_id, provider_message_id, direction, type, body, media_id, occurred_at)
                values (?, ?, 'INBOUND', ?, ?, ?, ?)
                on conflict (provider_message_id) do nothing
                """,
                contactId,
                message.messageId(),
                message.type(),
                message.body(),
                message.mediaId(),
                Timestamp.from(message.occurredAt()));
        if (inserted > 0) {
            String preview = message.body() == null ? "[" + message.type() + "]" : message.body();
            jdbc.update(
                    """
                    update whatsapp_contacts
                    set last_message_at = ?, last_message_preview = ?, updated_at = now()
                    where id = ? and (last_message_at is null or last_message_at <= ?)
                    """,
                    Timestamp.from(message.occurredAt()),
                    truncate(preview, 500),
                    contactId,
                    Timestamp.from(message.occurredAt()));
        }
    }

    public WhatsAppPageDto<WhatsAppContactDto> contacts(String query, int page, int size) {
        int safePage = safePage(page);
        int safeSize = safeSize(size);
        String pattern = "%" + (query == null ? "" : query.trim()) + "%";
        Long total = jdbc.queryForObject(
                "select count(*) from whatsapp_contacts where wa_id ilike ? or display_name ilike ?",
                Long.class,
                pattern,
                pattern);
        List<WhatsAppContactDto> items = jdbc.query(
                """
                select id, wa_id, display_name, last_message_preview, last_message_at
                from whatsapp_contacts
                where wa_id ilike ? or display_name ilike ?
                order by last_message_at desc nulls last, id desc
                limit ? offset ?
                """,
                (rs, rowNum) -> new WhatsAppContactDto(
                        rs.getLong("id"),
                        rs.getString("wa_id"),
                        rs.getString("display_name"),
                        rs.getString("last_message_preview"),
                        instant(rs.getTimestamp("last_message_at"))),
                pattern,
                pattern,
                safeSize,
                (long) safePage * safeSize);
        return new WhatsAppPageDto<>(items, total == null ? 0 : total, safePage, safeSize);
    }

    public WhatsAppPageDto<WhatsAppMessageDto> messages(long contactId, int page, int size) {
        Long contactCount = jdbc.queryForObject(
                "select count(*) from whatsapp_contacts where id = ?", Long.class, contactId);
        if (contactCount == null || contactCount == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "WhatsApp contact not found");
        }
        int safePage = safePage(page);
        int safeSize = safeSize(size);
        Long total = jdbc.queryForObject(
                "select count(*) from whatsapp_messages where contact_id = ?", Long.class, contactId);
        List<WhatsAppMessageDto> newestFirst = jdbc.query(
                """
                select id, direction, type, body, occurred_at, status
                from whatsapp_messages
                where contact_id = ?
                order by occurred_at desc, id desc
                limit ? offset ?
                """,
                (rs, rowNum) -> new WhatsAppMessageDto(
                        rs.getLong("id"),
                        rs.getString("direction"),
                        rs.getString("type"),
                        rs.getString("body"),
                        instant(rs.getTimestamp("occurred_at")),
                        rs.getString("status")),
                contactId,
                safeSize,
                (long) safePage * safeSize);
        List<WhatsAppMessageDto> items = new ArrayList<>(newestFirst);
        Collections.reverse(items);
        return new WhatsAppPageDto<>(items, total == null ? 0 : total, safePage, safeSize);
    }

    private static int safePage(int page) {
        return Math.max(0, Math.min(page, 1_000_000));
    }

    private static int safeSize(int size) {
        return Math.max(1, Math.min(size, 100));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private static String truncate(String value, int maxLength) {
        return value == null || value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
