package kz.company.shop.integrations.gpt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
class GptUsageRecorderIntegrationTest {
    @Autowired private GptUsageRecorder recorder;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private TransactionTemplate transactionTemplate;

    @Test
    void storesDetailedUsageEvenWhenCallingTransactionRollsBack() {
        String responseId = "resp_test_" + UUID.randomUUID();
        try {
            transactionTemplate.execute(
                    status -> {
                        recorder.record(
                                new GptUsage(
                                        responseId,
                                        "product_summary",
                                        "gpt-6-luna",
                                        "completed",
                                        200,
                                        120L,
                                        30L,
                                        150L,
                                        40L,
                                        10L,
                                        8L,
                                        725));
                        status.setRollbackOnly();
                        return null;
                    });

            Map<String, Object> row =
                    jdbcTemplate.queryForMap(
                            "select * from gpt_api_usage where response_id = ?", responseId);
            assertEquals("product_summary", row.get("feature"));
            assertEquals("gpt-6-luna", row.get("model"));
            assertEquals("completed", row.get("status"));
            assertEquals(200, row.get("http_status"));
            assertEquals(120L, row.get("input_tokens"));
            assertEquals(30L, row.get("output_tokens"));
            assertEquals(150L, row.get("total_tokens"));
            assertEquals(40L, row.get("cached_input_tokens"));
            assertEquals(10L, row.get("cache_write_tokens"));
            assertEquals(8L, row.get("reasoning_output_tokens"));
            assertEquals(725L, row.get("duration_ms"));
        } finally {
            jdbcTemplate.update("delete from gpt_api_usage where response_id = ?", responseId);
        }
    }

    @Test
    void keepsUnknownTokenCountsNullForFailedRequests() {
        // An HTTP error has no response ID or reported usage.
        String feature = "gpt_test_" + UUID.randomUUID();
        recorder.record(
                new GptUsage(
                        null,
                        feature,
                        "gpt-6-luna",
                        "http_error",
                        429,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        32));
        Long id =
                jdbcTemplate.queryForObject(
                        "select max(id) from gpt_api_usage where feature = ? and status = ? and response_id is null",
                        Long.class,
                        feature,
                        "http_error");
        try {
            Map<String, Object> row =
                    jdbcTemplate.queryForMap("select * from gpt_api_usage where id = ?", id);
            assertNull(row.get("input_tokens"));
            assertNull(row.get("output_tokens"));
            assertNull(row.get("total_tokens"));
        } finally {
            jdbcTemplate.update("delete from gpt_api_usage where id = ?", id);
        }
    }
}
