package kz.company.shop.priceImports.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class PriceImportProperties {
    public final String pythonExecutable;
    public final String scriptPath;
    public final String tempDir;
    public final long timeoutSeconds;
    public final long maxFileSizeBytes;
    public final long maxOutputSizeBytes;
    public final int maxRows;

    public PriceImportProperties(
            @Value("${app.price-import.python-executable}") String pythonExecutable,
            @Value("${app.price-import.script-path}") String scriptPath,
            @Value("${app.price-import.temp-dir}") String tempDir,
            @Value("${app.price-import.timeout-seconds}") long timeoutSeconds,
            @Value("${app.price-import.max-file-size-bytes}") long maxFileSizeBytes,
            @Value("${app.price-import.max-output-size-bytes}") long maxOutputSizeBytes,
            @Value("${app.price-import.max-rows}") int maxRows) {
        this.pythonExecutable = pythonExecutable;
        this.scriptPath = scriptPath;
        this.tempDir = tempDir;
        this.timeoutSeconds = timeoutSeconds;
        this.maxFileSizeBytes = maxFileSizeBytes;
        this.maxOutputSizeBytes = maxOutputSizeBytes;
        this.maxRows = maxRows;
    }
}
