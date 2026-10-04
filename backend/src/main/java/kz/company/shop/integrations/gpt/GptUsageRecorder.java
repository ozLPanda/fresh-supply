package kz.company.shop.integrations.gpt;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GptUsageRecorder {
    private final JdbcTemplate jdbcTemplate;

    public GptUsageRecorder(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** The usage record survives a later rollback in the calling feature. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(GptUsage usage) {
        jdbcTemplate.update(
                """
                insert into gpt_api_usage (
                    response_id, feature, model, status, http_status, input_tokens, output_tokens,
                    total_tokens, cached_input_tokens, cache_write_tokens,
                    reasoning_output_tokens, duration_ms
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (response_id) do nothing
                """,
                usage.responseId(),
                usage.feature(),
                usage.model(),
                usage.status(),
                usage.httpStatus(),
                usage.inputTokens(),
                usage.outputTokens(),
                usage.totalTokens(),
                usage.cachedInputTokens(),
                usage.cacheWriteTokens(),
                usage.reasoningOutputTokens(),
                usage.durationMs());
    }
}
