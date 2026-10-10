package kz.company.shop.desktop;

import java.io.IOException;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration
@Profile("desktop")
public class DesktopWebConfig implements WebMvcConfigurer {
    private final String webRoot;

    public DesktopWebConfig(@Value("${app.desktop.web-root}") String webRoot) {
        this.webRoot = Path.of(webRoot).toAbsolutePath().normalize().toUri().toString();
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations(
                        webRoot.endsWith("/") ? webRoot : webRoot + "/", "classpath:/static/")
                .setCacheControl(CacheControl.noCache())
                .resourceChain(false)
                .addResolver(new SpaResourceResolver());
    }

    static class SpaResourceResolver extends PathResourceResolver {
        @Override
        protected Resource getResource(String resourcePath, Resource location) throws IOException {
            if (reservedPath(resourcePath)) return null;
            if (resourcePath.isEmpty()) return super.getResource("index.html", location);
            Resource resource = super.getResource(resourcePath, location);
            if (resource != null) return resource;
            // Missing assets and API URLs keep their real 404 rather than becoming HTML.
            if (resourcePath.contains(".")) return null;
            return super.getResource("index.html", location);
        }

        private static boolean reservedPath(String path) {
            return path.equals("__desktop")
                    || path.startsWith("__desktop/")
                    || path.equals("api")
                    || path.startsWith("api/")
                    || path.equals("actuator")
                    || path.startsWith("actuator/")
                    || path.equals("error")
                    || path.startsWith("error/")
                    || path.startsWith("v3/api-docs")
                    || path.startsWith("swagger-ui");
        }
    }
}
