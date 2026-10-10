package kz.company.shop.datatransfer;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.DataInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipFile;
import javax.sql.DataSource;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.DesktopObjectStorageService;
import kz.company.shop.files.service.ObjectStorageService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DataTransferExportServiceTest {
    @TempDir Path temporary;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, PreparedStatement> tableStatements = new java.util.HashMap<>();

    @Test
    void exportsTypedRowsFilesSequencesAndExclusionsWithExactChecksums() throws Exception {
        byte[] payload = "файл\n".getBytes(StandardCharsets.UTF_8);
        var storage = new DesktopObjectStorageService(temporary.resolve("files").toString());
        storage.put(
                "uploads/photo.png",
                new java.io.ByteArrayInputStream(payload),
                payload.length,
                "image/png");
        var fixtures = new LinkedHashMap<String, Fixture>();
        fixtures.put(
                "categories",
                new Fixture(
                        List.of(
                                new String[] {"id", "bigint"},
                                new String[] {"image_file_path", "character varying(500)"},
                                new String[] {"image_content_hash", "character varying(64)"}),
                        List.<String[]>of(
                                new String[] {
                                    "9007199254740993", "/uploads/photo.png", hash(payload)
                                })));
        fixtures.put(
                "products",
                new Fixture(
                        List.of(
                                new String[] {"id", "bigint"},
                                new String[] {"purchase_price", "numeric(38,8)"},
                                new String[] {"details", "jsonb"},
                                new String[] {"embedding", "vector(768)"},
                                new String[] {"created_at", "timestamp with time zone"},
                                new String[] {"binary", "bytea"},
                                new String[] {"note", "text"}),
                        List.<String[]>of(
                                new String[] {
                                    "9007199254740993",
                                    "12345678901234567890.12345678",
                                    "{\"a\":1}",
                                    "[0.1,0.2]",
                                    "2026-10-10 12:00:00+05",
                                    "\\x0011ff",
                                    null
                                })));
        fixtures.put(
                "users",
                new Fixture(
                        List.<String[]>of(new String[] {"password_hash", "character varying(120)"}),
                        List.<String[]>of(new String[] {"fixture-password-hash"})));
        DataSource source = source(fixtures);
        var service = service(source, storage);
        Path archivePath;
        try (var archive = service.export();
                var zip = new ZipFile(archive.path().toFile())) {
            archivePath = archive.path();
            var manifest = mapper.readTree(zip.getInputStream(zip.getEntry("manifest.json")));
            assertThat(manifest.path("format").asText()).isEqualTo("ovoshi-help-data-transfer");
            assertThat(manifest.path("schemaVersion").asText()).isEqualTo("134");
            assertThat(manifest.path("tables").size()).isEqualTo(3);
            assertThat(manifest.path("sequences").get(0).path("isCalled").asBoolean()).isTrue();
            assertThat(manifest.path("sequences").get(0).path("lastValue").asText())
                    .isEqualTo("9007199254740999");
            assertThat(manifest.path("excludedTables").toString())
                    .contains(
                            "auth_sessions", "external_api_credentials", "web_push_subscriptions");
            for (var table : manifest.path("tables")) {
                byte[] bytes =
                        zip.getInputStream(zip.getEntry(table.path("entry").asText()))
                                .readAllBytes();
                assertThat(table.path("size").asLong()).isEqualTo(bytes.length);
                assertThat(table.path("sha256").asText()).isEqualTo(hash(bytes));
                assertThat(table.path("rowCount").asLong()).isEqualTo(1);
                var row = mapper.readTree(bytes);
                for (var value : row) assertThat(value.isTextual() || value.isNull()).isTrue();
                if (table.path("name").asText().equals("products")) {
                    assertThat(row.get(0).asText()).isEqualTo("9007199254740993");
                    assertThat(row.get(1).asText()).isEqualTo("12345678901234567890.12345678");
                    assertThat(row.get(3).asText()).isEqualTo("[0.1,0.2]");
                    assertThat(row.get(6).isNull()).isTrue();
                }
            }
            var file = manifest.path("files").get(0);
            assertThat(file.path("key").asText()).isEqualTo("uploads/photo.png");
            assertThat(file.path("entry").asText())
                    .isEqualTo(
                            "files/"
                                    + hash("uploads/photo.png".getBytes(StandardCharsets.UTF_8))
                                    + ".object");
            byte[] encoded =
                    zip.getInputStream(zip.getEntry(file.path("entry").asText())).readAllBytes();
            assertThat(file.path("size").asLong()).isEqualTo(encoded.length);
            assertThat(file.path("sha256").asText()).isEqualTo(hash(encoded));
            try (var input = new DataInputStream(new java.io.ByteArrayInputStream(encoded))) {
                assertThat(input.readInt()).isEqualTo(0x4F564F31);
                assertThat(input.readUTF()).isEqualTo("image/png");
                assertThat(input.readAllBytes()).isEqualTo(payload);
            }
        }
        assertThat(archivePath).doesNotExist();
        verify(source.getConnection())
                .setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
        verify(source.getConnection()).setReadOnly(true);
        verify(tableStatements.get("products")).setFetchSize(1);
        verify(tableStatements.get("categories")).setFetchSize(500);
        verify(source.getConnection()).rollback();
    }

    @Test
    void missingReferencedFileRejectsWholeExportAndRemovesTemporaryArchive() throws Exception {
        var storage = new DesktopObjectStorageService(temporary.resolve("files").toString());
        var service =
                service(source(Map.of("categories", category("/uploads/missing.png"))), storage);
        assertThatThrownBy(service::export)
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("отсутствует или изменился");
        try (var files = Files.list(temporary.resolve("exports"))) {
            assertThat(files.toList()).isEmpty();
        }
    }

    @Test
    void changedFileRejectsArchiveAndClosesItsStream() throws Exception {
        ObjectStorageService storage = mock(ObjectStorageService.class);
        var closed = new java.util.concurrent.atomic.AtomicBoolean();
        var input =
                new java.io.ByteArrayInputStream(new byte[] {1}) {
                    @Override
                    public void close() throws java.io.IOException {
                        closed.set(true);
                        super.close();
                    }
                };
        when(storage.listObjectKeys()).thenReturn(java.util.Set.of());
        when(storage.fingerprint("uploads/file")).thenReturn("before", "after");
        when(storage.get("uploads/file"))
                .thenReturn(new ObjectStorageService.StoredObject(input, 1, "text/plain"));
        var service = service(source(Map.of("categories", category("/uploads/file"))), storage);
        assertThatThrownBy(service::export)
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("отсутствует или изменился");
        assertThat(closed).isTrue();
        try (var files = Files.list(temporary.resolve("exports"))) {
            assertThat(files.toList()).isEmpty();
        }
    }

    @Test
    void sourceFailureDoesNotExposeConnectionDetailsAndCleansArchive() throws Exception {
        var source = mock(DataSource.class);
        when(source.getConnection())
                .thenThrow(new java.sql.SQLException("password=private fixture"));
        assertThatThrownBy(service(source, mock(ObjectStorageService.class))::export)
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageNotContaining("password");
    }

    private DataTransferExportService service(DataSource source, ObjectStorageService storage) {
        return new DataTransferExportService(
                source,
                mapper,
                storage,
                new DataTransferBarrier(),
                temporary.resolve("exports").toString());
    }

    private Fixture category(String path) {
        return new Fixture(
                List.<String[]>of(new String[] {"image_file_path", "text"}),
                List.<String[]>of(new String[] {path}));
    }

    private DataSource source(Map<String, Fixture> fixtures) throws Exception {
        Connection connection = mock(Connection.class);
        DataSource source = mock(DataSource.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.prepareStatement(anyString()))
                .thenAnswer(
                        call -> {
                            String sql = call.getArgument(0);
                            var statement = mock(PreparedStatement.class);
                            if (sql.contains("select version"))
                                when(statement.executeQuery())
                                        .thenAnswer(
                                                ignored ->
                                                        rows(
                                                                List.<String[]>of(
                                                                        new String[] {"134"})));
                            else if (sql.contains("pg_inherits"))
                                when(statement.executeQuery())
                                        .thenAnswer(
                                                ignored ->
                                                        rows(
                                                                List.<String[]>of(
                                                                        new String[] {
                                                                            "external_api_request_logs_2026_10"
                                                                        })));
                            else if (sql.contains("relkind in")) {
                                var names = new java.util.ArrayList<String[]>();
                                for (String name : fixtures.keySet())
                                    names.add(new String[] {name});
                                for (String name : DataTransferExportService.EXCLUDED_TABLES)
                                    names.add(new String[] {name});
                                when(statement.executeQuery()).thenAnswer(ignored -> rows(names));
                            } else if (sql.contains("relkind = 'S'"))
                                when(statement.executeQuery())
                                        .thenAnswer(
                                                ignored ->
                                                        rows(
                                                                List.<String[]>of(
                                                                        new String[] {
                                                                            "product_sku_seq"
                                                                        })));
                            else if (sql.contains("select last_value"))
                                when(statement.executeQuery())
                                        .thenAnswer(
                                                ignored ->
                                                        rows(
                                                                List.<String[]>of(
                                                                        new String[] {
                                                                            "9007199254740999",
                                                                            "true"
                                                                        })));
                            else if (sql.contains("pg_attribute")) {
                                var name = new AtomicReference<String>();
                                doAnswer(
                                                set -> {
                                                    name.set(set.getArgument(1));
                                                    return null;
                                                })
                                        .when(statement)
                                        .setString(eq(1), anyString());
                                when(statement.executeQuery())
                                        .thenAnswer(
                                                ignored ->
                                                        rows(fixtures.get(name.get()).columns()));
                            } else throw new AssertionError(sql);
                            return statement;
                        });
        when(connection.prepareStatement(anyString(), anyInt(), anyInt()))
                .thenAnswer(
                        call -> {
                            String sql = call.getArgument(0);
                            for (var fixture : fixtures.entrySet())
                                if (sql.endsWith("public.\"" + fixture.getKey() + "\"")) {
                                    var statement = mock(PreparedStatement.class);
                                    tableStatements.put(fixture.getKey(), statement);
                                    when(statement.executeQuery())
                                            .thenAnswer(ignored -> rows(fixture.getValue().rows()));
                                    return statement;
                                }
                            throw new AssertionError(sql);
                        });
        return source;
    }

    private ResultSet rows(List<String[]> values) throws Exception {
        ResultSet result = mock(ResultSet.class);
        var index = new AtomicInteger(-1);
        when(result.next()).thenAnswer(ignored -> index.incrementAndGet() < values.size());
        when(result.getString(anyInt()))
                .thenAnswer(call -> values.get(index.get())[(Integer) call.getArgument(0) - 1]);
        when(result.getBoolean(anyInt()))
                .thenAnswer(
                        call ->
                                Boolean.parseBoolean(
                                        values.get(index.get())[
                                                (Integer) call.getArgument(0) - 1]));
        return result;
    }

    private static String hash(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private record Fixture(List<String[]> columns, List<String[]> rows) {}
}
