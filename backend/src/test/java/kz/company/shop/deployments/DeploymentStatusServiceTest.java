package kz.company.shop.deployments;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.IntStream;
import kz.company.shop.common.exception.AppExceptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DeploymentStatusServiceTest {
    @TempDir Path directory;

    @Test
    void reportsUnavailableWhenStatusIsMissingOrInvalid() throws IOException {
        DeploymentStatusService service =
                new DeploymentStatusService(new ObjectMapper(), directory.toString());

        assertThat(service.get().state()).isEqualTo("unavailable");
        assertThat(service.get().history()).isEmpty();

        Files.writeString(directory.resolve("status.json"), "{\"state\":\"unexpected\"}");
        assertThat(service.get().state()).isEqualTo("unavailable");
    }

    @Test
    void acceptsStatusBeforeHistoryFileExists() throws IOException {
        Files.writeString(
                directory.resolve("status.json"),
                """
                {"state":"running","deployedRevision":"abc","targetRevision":"def",
                 "checkedAt":"2026-09-29T10:00:00Z","startedAt":"2026-09-29T10:01:00Z",
                 "finishedAt":null}
                """);

        var status = new DeploymentStatusService(new ObjectMapper(), directory.toString()).get();

        assertThat(status.state()).isEqualTo("running");
        assertThat(status.deployedRevision()).isEqualTo("abc");
        assertThat(status.targetRevision()).isEqualTo("def");
        assertThat(status.finishedAt()).isNull();
        assertThat(status.attemptId()).isNull();
        assertThat(status.stage()).isNull();
        assertThat(status.history()).isEmpty();
    }

    @Test
    void readsCurrentAttemptAndStage() throws IOException {
        Files.writeString(
                directory.resolve("status.json"),
                """
                {"state":"running","attemptId":"attempt_20260930_0920","stage":"building"}
                """);

        var status = new DeploymentStatusService(new ObjectMapper(), directory.toString()).get();

        assertThat(status.attemptId()).isEqualTo("attempt_20260930_0920");
        assertThat(status.stage()).isEqualTo("building");
    }

    @Test
    void keepsTenLatestCompletedAttemptsNewestFirst() throws IOException {
        Files.writeString(directory.resolve("status.json"), "{\"state\":\"succeeded\"}");
        String history =
                IntStream.range(0, 12)
                        .mapToObj(
                                index ->
                                        "{\"revision\":\"rev-"
                                                + index
                                                + "\",\"state\":\"succeeded\",\"startedAt\":null,\"finishedAt\":null}")
                        .reduce("", (left, right) -> left + right + "\n");
        Files.writeString(directory.resolve("history.jsonl"), history);

        var status = new DeploymentStatusService(new ObjectMapper(), directory.toString()).get();

        assertThat(status.history()).hasSize(10);
        assertThat(status.history().getFirst().revision()).isEqualTo("rev-11");
        assertThat(status.history().getFirst().attemptId()).isNull();
        assertThat(status.history().getLast().revision()).isEqualTo("rev-2");
    }

    @Test
    void readsAttemptIdFromHistory() throws IOException {
        Files.writeString(directory.resolve("status.json"), "{\"state\":\"idle\"}");
        Files.writeString(
                directory.resolve("history.jsonl"),
                "{\"attemptId\":\"run_1\",\"revision\":\"abc\",\"state\":\"succeeded\"}\n");

        var status = new DeploymentStatusService(new ObjectMapper(), directory.toString()).get();

        assertThat(status.history()).hasSize(1);
        assertThat(status.history().getFirst().attemptId()).isEqualTo("run_1");
    }

    @Test
    void readsUpdatedLogTailWithSizeLimit() throws IOException {
        Path logs = Files.createDirectory(directory.resolve("logs"));
        Path log = logs.resolve("run_1.log");
        DeploymentStatusService service =
                new DeploymentStatusService(new ObjectMapper(), directory.toString());

        assertThat(service.getLog("run_1").text()).isEmpty();
        Files.writeString(log, "starting\n");
        assertThat(service.getLog("run_1").text()).isEqualTo("starting\n");
        Files.writeString(log, "finished\n", java.nio.file.StandardOpenOption.APPEND);
        assertThat(service.getLog("run_1").text()).isEqualTo("starting\nfinished\n");
        assertThat(service.getLog("run_1").truncated()).isFalse();

        Files.writeString(log, "x".repeat(200 * 1024) + "END");
        var tail = service.getLog("run_1");
        assertThat(tail.truncated()).isTrue();
        assertThat(tail.text()).hasSize(200 * 1024).endsWith("END");
    }

    @Test
    void rejectsUnsafeAttemptIds() {
        DeploymentStatusService service =
                new DeploymentStatusService(new ObjectMapper(), directory.toString());

        for (String attemptId : new String[] {"../secret", "..", "run.1", "a/b", "a\\b", "a%2fb"}) {
            assertThatThrownBy(() -> service.getLog(attemptId))
                    .isInstanceOf(AppExceptions.BadRequest.class);
        }
    }

    @Test
    void corruptHistoryDoesNotBreakEndpoint() throws IOException {
        Files.writeString(directory.resolve("status.json"), "{\"state\":\"idle\"}");
        Files.writeString(directory.resolve("history.jsonl"), "not json\n");

        var status = new DeploymentStatusService(new ObjectMapper(), directory.toString()).get();

        assertThat(status.state()).isEqualTo("unavailable");
        assertThat(status.history()).isEmpty();
    }
}
