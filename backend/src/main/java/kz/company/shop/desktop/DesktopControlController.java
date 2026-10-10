package kz.company.shop.desktop;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Per-launch native control; the random token never enters the frontend or session cookies. */
@RestController
@Profile("desktop")
public class DesktopControlController {
    private final byte[] token;
    private final Runnable shutdown;
    private final AtomicBoolean stopping = new AtomicBoolean();

    @Autowired
    public DesktopControlController(
            @Value("${app.desktop.control-token}") String token,
            ConfigurableApplicationContext context) {
        this(
                token,
                () -> {
                    try {
                        context.close();
                    } finally {
                        System.exit(0);
                    }
                });
    }

    DesktopControlController(String token, Runnable shutdown) {
        if (token == null || token.length() < 32) {
            throw new IllegalStateException(
                    "APP_DESKTOP_CONTROL_TOKEN must contain at least 32 characters");
        }
        this.token = token.getBytes(StandardCharsets.UTF_8);
        this.shutdown = shutdown;
    }

    @PostMapping("/__desktop/shutdown")
    public ResponseEntity<Void> shutdown(
            HttpServletRequest request,
            @RequestHeader(value = "X-Ovoshi-Control", required = false) String providedToken) {
        if (!isLoopback(request.getRemoteAddr())
                || providedToken == null
                || !MessageDigest.isEqual(token, providedToken.getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(403).build();
        }
        if (stopping.compareAndSet(false, true)) {
            // Return the acknowledgement before closing the server; graceful shutdown drains
            // requests.
            Thread.ofPlatform()
                    .name("desktop-graceful-shutdown")
                    .start(
                            () -> {
                                try {
                                    Thread.sleep(150);
                                } catch (InterruptedException ex) {
                                    Thread.currentThread().interrupt();
                                }
                                shutdown.run();
                            });
        }
        return ResponseEntity.accepted().build();
    }

    private static boolean isLoopback(String address) {
        if (address == null || address.isBlank()) return false;
        try {
            return InetAddress.getByName(address).isLoopbackAddress();
        } catch (Exception ex) {
            return false;
        }
    }
}
