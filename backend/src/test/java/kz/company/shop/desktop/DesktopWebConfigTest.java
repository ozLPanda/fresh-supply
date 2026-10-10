package kz.company.shop.desktop;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.FileSystemResource;

class DesktopWebConfigTest {
    @TempDir Path root;

    @Test
    void nestedSpaRoutesResolveButMissingAssetsAndApiDoNot() throws Exception {
        Files.writeString(root.resolve("index.html"), "<html>app</html>");
        Files.writeString(root.resolve("app.js"), "app()");
        var resolver = new DesktopWebConfig.SpaResourceResolver();
        var location = new FileSystemResource(root.toString() + "/");
        assertThat(resolver.getResource("", location).getFilename()).isEqualTo("index.html");
        assertThat(resolver.getResource("admin/orders/42/edit", location).getFilename())
                .isEqualTo("index.html");
        assertThat(resolver.getResource("app.js", location).getFilename()).isEqualTo("app.js");
        assertThat(resolver.getResource("missing.js", location)).isNull();
        assertThat(resolver.getResource("api/missing", location)).isNull();
        assertThat(resolver.getResource("actuator/secret", location)).isNull();
        assertThat(resolver.getResource("__desktop/missing", location)).isNull();
        assertThat(resolver.getResource("../secret", location)).isNull();
    }
}
