package kz.company.shop.deployments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import kz.company.shop.common.exception.AppExceptions;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class DeploymentStatusService {
    private static final Set<String> STATES = Set.of("idle", "running", "succeeded", "failed");
    private static final Set<String> FINISHED_STATES = Set.of("succeeded", "failed");
    private static final int HISTORY_LIMIT = 10;
    private static final int LOG_TAIL_LIMIT_BYTES = 200 * 1024;
    private static final Pattern ATTEMPT_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_-]{0,127}");

    private final ObjectMapper mapper;
    private final Path directory;

    public DeploymentStatusService(
            ObjectMapper mapper,
            @Value("${app.deploy.status-dir:/app/deploy-status}") String directory) {
        this.mapper = mapper;
        this.directory = Path.of(directory);
    }

    public DeploymentStatus get() {
        try {
            JsonNode status = mapper.readTree(directory.resolve("status.json").toFile());
            String state = requiredText(status, "state", STATES);
            List<Attempt> history = readHistory();
            return new DeploymentStatus(
                    state,
                    optionalText(status, "attemptId"),
                    optionalText(status, "stage"),
                    optionalText(status, "deployedRevision"),
                    optionalText(status, "targetRevision"),
                    optionalText(status, "checkedAt"),
                    optionalText(status, "startedAt"),
                    optionalText(status, "finishedAt"),
                    history);
        } catch (IOException | IllegalArgumentException exception) {
            return unavailable();
        }
    }

    public LogTail getLog(String attemptId) throws IOException {
        if (attemptId == null || !ATTEMPT_ID.matcher(attemptId).matches()) {
            throw new AppExceptions.BadRequest("Некорректный идентификатор попытки сборки");
        }

        Path file = directory.resolve("logs").resolve(attemptId + ".log");
        if (Files.notExists(file)) return new LogTail("", false);

        try (SeekableByteChannel channel =
                Files.newByteChannel(file, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            long size = channel.size();
            int length = (int) Math.min(size, LOG_TAIL_LIMIT_BYTES);
            ByteBuffer buffer = ByteBuffer.allocate(length);
            channel.position(size - length);
            while (buffer.hasRemaining() && channel.read(buffer) != -1) {
                // Read only the tail available when this request started.
            }
            buffer.flip();
            return new LogTail(StandardCharsets.UTF_8.decode(buffer).toString(), size > length);
        }
    }

    private List<Attempt> readHistory() throws IOException {
        Path file = directory.resolve("history.jsonl");
        if (Files.notExists(file)) return List.of();

        ArrayDeque<Attempt> latest = new ArrayDeque<>(HISTORY_LIMIT);
        try (BufferedReader reader = Files.newBufferedReader(file)) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;
                JsonNode entry = mapper.readTree(line);
                Attempt attempt =
                        new Attempt(
                                optionalText(entry, "attemptId"),
                                requiredText(entry, "revision", null),
                                requiredText(entry, "state", FINISHED_STATES),
                                optionalText(entry, "startedAt"),
                                optionalText(entry, "finishedAt"));
                if (latest.size() == HISTORY_LIMIT) latest.removeFirst();
                latest.addLast(attempt);
            }
        }
        List<Attempt> newestFirst = new ArrayList<>(latest.size());
        latest.descendingIterator().forEachRemaining(newestFirst::add);
        return newestFirst;
    }

    private static String requiredText(JsonNode node, String field, Set<String> values) {
        String value = optionalText(node, field);
        if (value == null || value.isBlank() || (values != null && !values.contains(value))) {
            throw new IllegalArgumentException("Invalid deployment status field: " + field);
        }
        return value;
    }

    private static String optionalText(JsonNode node, String field) {
        if (node == null || !node.isObject()) {
            throw new IllegalArgumentException("Invalid deployment status document");
        }
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) {
            throw new IllegalArgumentException("Invalid deployment status field: " + field);
        }
        return value.asText();
    }

    private static DeploymentStatus unavailable() {
        return new DeploymentStatus(
                "unavailable", null, null, null, null, null, null, null, List.of());
    }

    public record DeploymentStatus(
            String state,
            String attemptId,
            String stage,
            String deployedRevision,
            String targetRevision,
            String checkedAt,
            String startedAt,
            String finishedAt,
            List<Attempt> history) {}

    public record Attempt(
            String attemptId, String revision, String state, String startedAt, String finishedAt) {}

    public record LogTail(String text, boolean truncated) {}
}
