package kz.company.shop.integrations.onec.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.Locale;
import java.util.Map;
import kz.company.shop.orders.service.UuidV7Generator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Stores audit records for every external API credential without affecting API responses. */
@Service
public class ExternalApiRequestLogService {
    private static final Logger LOGGER =
            LoggerFactory.getLogger(ExternalApiRequestLogService.class);
    private static final ZoneId PARTITION_TIME_ZONE = ZoneId.of("Asia/Qyzylorda");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final UuidV7Generator uuidV7Generator;

    public ExternalApiRequestLogService(
            JdbcTemplate jdbcTemplate, ObjectMapper objectMapper, UuidV7Generator uuidV7Generator) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.uuidV7Generator = uuidV7Generator;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(
            Long credentialId,
            String httpMethod,
            String route,
            Map<String, ?> parameters,
            String status) {
        try {
            Instant calledAt = Instant.now();
            ensureMonthlyPartition(calledAt);
            jdbcTemplate.update(
                    """
                    insert into external_api_request_logs (
                        id, credential_id, http_method, route, parameters, status, called_at
                    )
                    values (?, ?, ?, ?, cast(? as jsonb), ?, ?)
                    """,
                    uuidV7Generator.next(),
                    credentialId,
                    httpMethod,
                    route,
                    objectMapper.writeValueAsString(parameters),
                    status,
                    Timestamp.from(calledAt));
        } catch (JsonProcessingException | RuntimeException exception) {
            LOGGER.warn("Unable to write external API request log", exception);
        }
    }

    private void ensureMonthlyPartition(Instant calledAt) {
        YearMonth month = YearMonth.from(calledAt.atZone(PARTITION_TIME_ZONE));
        Instant from = month.atDay(1).atStartOfDay(PARTITION_TIME_ZONE).toInstant();
        Instant to = month.plusMonths(1).atDay(1).atStartOfDay(PARTITION_TIME_ZONE).toInstant();
        String partitionName =
                String.format(
                        Locale.ROOT,
                        "external_api_request_logs_%04d_%02d",
                        month.getYear(),
                        month.getMonthValue());
        jdbcTemplate.execute(
                "create table if not exists "
                        + partitionName
                        + " partition of external_api_request_logs for values from ('"
                        + from
                        + "') to ('"
                        + to
                        + "')");
    }
}
