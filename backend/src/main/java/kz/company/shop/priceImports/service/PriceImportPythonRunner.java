package kz.company.shop.priceImports.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.priceImports.entity.ImportPriceType;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

@Component
public class PriceImportPythonRunner {
    private final ObjectMapper objectMapper;
    private final PriceImportProperties properties;

    public PriceImportPythonRunner(ObjectMapper objectMapper, PriceImportProperties properties) {
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    public Analysis analyze(MultipartFile file) {
        return analyze(file, (ImportPriceType) null);
    }

    int maxRows() {
        return properties.maxRows;
    }

    /** Compatibility bridge for older internal callers that still use order price tiers. */
    @Deprecated
    public Analysis analyze(MultipartFile file, PriceTier oneCPriceTier) {
        return analyze(
                file, oneCPriceTier == null ? null : ImportPriceType.valueOf(oneCPriceTier.name()));
    }

    public Analysis analyze(MultipartFile file, ImportPriceType oneCPriceTier) {
        if (file == null) throw new AppExceptions.BadRequest("Файл импорта не передан");
        String fileName = safeFileName(file.getOriginalFilename());
        String suffix = extension(fileName);
        validateUpload(file, suffix, oneCPriceTier);

        Path input = null;
        Path output = null;
        Path processLog = null;
        try {
            Path tempDir = Path.of(properties.tempDir).toAbsolutePath().normalize();
            Files.createDirectories(tempDir);
            input = Files.createTempFile(tempDir, "price-import-", suffix);
            output = Files.createTempFile(tempDir, "price-import-result-", ".json");
            processLog = Files.createTempFile(tempDir, "price-import-process-", ".log");
            copyWithLimit(file, input);
            validateSignature(input, suffix);
            runPython(input, output, processLog, oneCPriceTier);
            return readAnalysis(output);
        } catch (AppExceptions.BadRequest exception) {
            throw exception;
        } catch (IOException exception) {
            throw new AppExceptions.BadRequest("Не удалось обработать файл импорта");
        } finally {
            deleteQuietly(input);
            deleteQuietly(output);
            deleteQuietly(processLog);
        }
    }

    private void validateUpload(MultipartFile file, String suffix, ImportPriceType oneCPriceTier) {
        if (file == null || file.isEmpty()) {
            throw new AppExceptions.BadRequest("Файл импорта пуст");
        }
        if (!".xlsx".equals(suffix) && !".xlsm".equals(suffix) && !".mxl".equals(suffix)) {
            throw new AppExceptions.BadRequest("Разрешены файлы XLSX, XLSM и выгрузки 1С MXL");
        }
        if (".mxl".equals(suffix) && oneCPriceTier == null) {
            throw new AppExceptions.BadRequest("Для выгрузки 1С выберите тип цены");
        }
        if (file.getSize() > properties.maxFileSizeBytes) {
            throw new AppExceptions.BadRequest("Файл импорта превышает 2 ГБ");
        }
    }

    private void copyWithLimit(MultipartFile file, Path target) throws IOException {
        long total = 0;
        byte[] buffer = new byte[8192];
        try (InputStream input = file.getInputStream();
                OutputStream output =
                        Files.newOutputStream(
                                target,
                                StandardOpenOption.TRUNCATE_EXISTING,
                                StandardOpenOption.WRITE)) {
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > properties.maxFileSizeBytes) {
                    throw new AppExceptions.BadRequest("Файл импорта превышает 2 ГБ");
                }
                output.write(buffer, 0, read);
            }
        }
    }

    private void validateSignature(Path input, String suffix) throws IOException {
        byte[] signature = new byte[4];
        try (InputStream stream = Files.newInputStream(input)) {
            if (".mxl".equals(suffix)) {
                if (stream.read(signature) != signature.length
                        || signature[0] != 'M'
                        || signature[1] != 'O'
                        || signature[2] != 'X'
                        || signature[3] != 'C') {
                    throw new AppExceptions.BadRequest(
                            "Файл не является корректной выгрузкой 1С MXL");
                }
                return;
            }
            if (stream.read(signature) != signature.length
                    || signature[0] != 'P'
                    || signature[1] != 'K'
                    || signature[2] != 3
                    || signature[3] != 4) {
                throw new AppExceptions.BadRequest("Файл не является корректным XLSX/XLSM архивом");
            }
        }
    }

    private void runPython(Path input, Path output, Path processLog, ImportPriceType oneCPriceTier)
            throws IOException {
        Path script = Path.of(properties.scriptPath).toAbsolutePath().normalize();
        if (!Files.isRegularFile(script)) {
            throw new AppExceptions.BadRequest("Скрипт анализа прайс-листа не найден");
        }

        List<String> command =
                new ArrayList<>(
                        List.of(
                                properties.pythonExecutable,
                                script.toString(),
                                input.toString(),
                                output.toString()));
        if (oneCPriceTier != null)
            command.addAll(List.of("--one-c-price-tier", oneCPriceTier.name()));
        Process process =
                new ProcessBuilder(command)
                        .redirectErrorStream(true)
                        .redirectOutput(processLog.toFile())
                        .start();
        boolean finished;
        try {
            finished = process.waitFor(properties.timeoutSeconds, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new AppExceptions.BadRequest("Анализ прайс-листа был прерван");
        }
        if (!finished) {
            process.destroyForcibly();
            throw new AppExceptions.BadRequest("Превышено время анализа прайс-листа");
        }
        if (process.exitValue() != 0) {
            throw new AppExceptions.BadRequest(
                    "Скрипт анализа завершился с ошибкой: " + readProcessMessage(processLog));
        }
    }

    private String readProcessMessage(Path processLog) {
        try (var reader = Files.newBufferedReader(processLog, StandardCharsets.UTF_8)) {
            char[] buffer = new char[500];
            int read = reader.read(buffer);
            String message = read <= 0 ? "" : new String(buffer, 0, read).trim();
            if (message.isBlank()) return "код ошибки без описания";
            return message;
        } catch (IOException ignored) {
            return "не удалось прочитать описание ошибки";
        }
    }

    private Analysis readAnalysis(Path output) throws IOException {
        if (!Files.isRegularFile(output) || Files.size(output) == 0) {
            throw new AppExceptions.BadRequest("Скрипт анализа не сформировал результат");
        }
        if (Files.size(output) > properties.maxOutputSizeBytes) {
            throw new AppExceptions.BadRequest("Результат анализа превышает допустимый размер");
        }

        String rawJson = Files.readString(output, StandardCharsets.UTF_8);
        JsonNode root;
        try {
            root = objectMapper.readTree(rawJson);
        } catch (IOException exception) {
            throw new AppExceptions.BadRequest("Скрипт анализа вернул некорректный JSON");
        }
        if (root == null || !root.isObject() || !root.hasNonNull("schemaVersion")) {
            throw new AppExceptions.BadRequest("Результат анализа не содержит schemaVersion");
        }
        if (root.path("schemaVersion").asInt(-1) != 1) {
            throw new AppExceptions.BadRequest("Версия результата анализа не поддерживается");
        }
        JsonNode workbookErrors = root.get("errors");
        if (workbookErrors != null && workbookErrors.isArray() && !workbookErrors.isEmpty()) {
            throw new AppExceptions.BadRequest(
                    "Файл не может быть импортирован: " + workbookErrors.get(0).asText());
        }
        JsonNode rowsNode = root.get("rows");
        if (rowsNode == null || !rowsNode.isArray()) {
            throw new AppExceptions.BadRequest("Результат анализа не содержит массив rows");
        }
        if (rowsNode.size() > properties.maxRows) {
            throw new AppExceptions.BadRequest("В файле слишком много строк для одного импорта");
        }

        List<SourceRow> rows = new ArrayList<>();
        for (int index = 0; index < rowsNode.size(); index++) {
            JsonNode row = rowsNode.get(index);
            rows.add(
                    new SourceRow(
                            text(row, "sourceSheet"),
                            integer(row, "sourceRow", index + 2),
                            text(row, "sku"),
                            text(row, "name"),
                            decimal(row, "price"),
                            decimal(row, "wholesalePrice"),
                            decimal(row, "bulkWholesalePrice"),
                            decimal(row, "skoPrice"),
                            row.path("missingRetailPrice").asBoolean(false),
                            errors(row.get("errors")),
                            decimal(row, "incomingPrice")));
        }
        return new Analysis(rawJson, rows);
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private int integer(JsonNode node, String field, int fallback) {
        JsonNode value = node == null ? null : node.get(field);
        return value != null && value.canConvertToInt() ? value.intValue() : fallback;
    }

    private BigDecimal decimal(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || value.isNull() || (value.isTextual() && value.asText().isBlank())) {
            return null;
        }
        try {
            return value.isNumber()
                    ? value.decimalValue()
                    : new BigDecimal(value.asText().trim().replace(',', '.'));
        } catch (NumberFormatException exception) {
            throw new AppExceptions.BadRequest(
                    "Результат анализа содержит некорректное поле " + field);
        }
    }

    private List<String> errors(JsonNode node) {
        if (node == null || node.isNull()) return List.of();
        if (node.isTextual()) return node.asText().isBlank() ? List.of() : List.of(node.asText());
        if (!node.isArray()) return List.of("Некорректный формат ошибок строки");
        List<String> result = new ArrayList<>();
        node.forEach(
                value ->
                        Optional.ofNullable(value.asText(null))
                                .filter(s -> !s.isBlank())
                                .ifPresent(result::add));
        return List.copyOf(result);
    }

    private String safeFileName(String original) {
        String value = Optional.ofNullable(original).orElse("prices.xlsx").replace('\\', '/');
        value = value.substring(value.lastIndexOf('/') + 1).trim();
        if (value.isBlank()) return "prices.xlsx";
        return value.length() > 260 ? value.substring(value.length() - 260) : value;
    }

    private String extension(String fileName) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        int dot = lower.lastIndexOf('.');
        return dot < 0 ? "" : lower.substring(dot);
    }

    private void deleteQuietly(Path file) {
        if (file == null) return;
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // Temporary files are best-effort cleanup; no public path is retained.
        }
    }

    public record Analysis(String rawJson, List<SourceRow> rows) {}

    public record SourceRow(
            String sourceSheet,
            int sourceRow,
            String sku,
            String name,
            BigDecimal price,
            BigDecimal wholesalePrice,
            BigDecimal bulkWholesalePrice,
            BigDecimal skoPrice,
            boolean missingRetailPrice,
            List<String> errors,
            BigDecimal incomingPrice) {
        /** Compatibility constructor for callers that do not provide an incoming price. */
        public SourceRow(
                String sourceSheet,
                int sourceRow,
                String sku,
                String name,
                BigDecimal price,
                BigDecimal wholesalePrice,
                BigDecimal bulkWholesalePrice,
                BigDecimal skoPrice,
                boolean missingRetailPrice,
                List<String> errors) {
            this(
                    sourceSheet,
                    sourceRow,
                    sku,
                    name,
                    price,
                    wholesalePrice,
                    bulkWholesalePrice,
                    skoPrice,
                    missingRetailPrice,
                    errors,
                    null);
        }

        /** Compatibility constructor for callers that do not provide an SКО price. */
        public SourceRow(
                String sourceSheet,
                int sourceRow,
                String sku,
                String name,
                BigDecimal price,
                BigDecimal wholesalePrice,
                BigDecimal bulkWholesalePrice,
                List<String> errors) {
            this(
                    sourceSheet,
                    sourceRow,
                    sku,
                    name,
                    price,
                    wholesalePrice,
                    bulkWholesalePrice,
                    null,
                    false,
                    errors,
                    null);
        }
    }
}
