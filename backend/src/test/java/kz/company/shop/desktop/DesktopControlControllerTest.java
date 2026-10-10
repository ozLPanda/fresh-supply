package kz.company.shop.desktop;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DesktopControlControllerTest {
    private static final String TOKEN = "test-control-token-00000000000000000001";

    @Test
    void rejectsMissingWrongAndNonLoopbackTokens() throws Exception {
        var controller =
                new DesktopControlController(
                        TOKEN,
                        () -> {
                            throw new AssertionError("Must not stop");
                        });
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(post("/__desktop/shutdown")).andExpect(status().isForbidden());
        mvc.perform(post("/__desktop/shutdown").header("X-Ovoshi-Control", "wrong"))
                .andExpect(status().isForbidden());
        mvc.perform(
                        post("/__desktop/shutdown")
                                .header("X-Ovoshi-Control", TOKEN)
                                .with(
                                        request -> {
                                            request.setRemoteAddr("203.0.113.1");
                                            return request;
                                        }))
                .andExpect(status().isForbidden());
    }

    @Test
    void acceptsPrivateLoopbackControlAndClosesExactlyOnceAfterAcknowledgement() throws Exception {
        var closed = new CountDownLatch(1);
        var closes = new AtomicInteger();
        var controller =
                new DesktopControlController(
                        TOKEN,
                        () -> {
                            closes.incrementAndGet();
                            closed.countDown();
                        });
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(post("/__desktop/shutdown").header("X-Ovoshi-Control", TOKEN))
                .andExpect(status().isAccepted());
        mvc.perform(post("/__desktop/shutdown").header("X-Ovoshi-Control", TOKEN))
                .andExpect(status().isAccepted());
        assertThat(closed.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(closes.get()).isEqualTo(1);
    }

    @Test
    void rejectsWeakControlConfiguration() {
        assertThatThrownBy(() -> new DesktopControlController("short", () -> {}))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void controlEndpointBeanIsAbsentOutsideDesktopProfile() {
        new ApplicationContextRunner()
                .withUserConfiguration(DesktopControlController.class)
                .run(
                        context ->
                                assertThat(context)
                                        .doesNotHaveBean(DesktopControlController.class));
        new ApplicationContextRunner()
                .withUserConfiguration(DesktopControlController.class)
                .withPropertyValues("app.desktop.control-token=" + TOKEN)
                .withInitializer(context -> context.getEnvironment().setActiveProfiles("desktop"))
                .run(context -> assertThat(context).hasSingleBean(DesktopControlController.class));
    }
}
