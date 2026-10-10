package kz.company.shop.datatransfer;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.file.Files;
import kz.company.shop.common.security.AuthContext;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DataTransferExportController {
    private final DataTransferExportService service;
    private final AuthContext auth;

    public DataTransferExportController(DataTransferExportService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping("/api/data-transfer/export")
    public void export(HttpServletResponse response) throws IOException {
        auth.require("data.export");
        // Build and verify the complete archive before setting any successful download headers.
        try (var archive = service.export()) {
            response.setContentType("application/zip");
            response.setContentLengthLong(archive.size());
            response.setHeader(
                    HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"ovoshi-help-data.zip\"");
            response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
            response.setHeader("X-Content-Type-Options", "nosniff");
            Files.copy(archive.path(), response.getOutputStream());
        }
    }
}
