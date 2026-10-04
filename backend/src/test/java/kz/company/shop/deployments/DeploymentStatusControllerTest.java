package kz.company.shop.deployments;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DeploymentStatusControllerTest {
    @TempDir Path directory;

    @Test
    void statusPollingIsNotCached() throws Exception {
        Files.writeString(
                directory.resolve("status.json"), "{\"state\":\"running\",\"stage\":\"building\"}");
        AuthContext auth = mock(AuthContext.class);

        mvc(auth)
                .perform(get("/api/admin/deployments/status"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.data.stage").value("building"));

        verify(auth).require("deployments.read");
    }

    @Test
    void returnsFreshLogWithNoStoreAndReadPermission() throws Exception {
        Path logs = Files.createDirectory(directory.resolve("logs"));
        Files.writeString(logs.resolve("run_1.log"), "building\n");
        AuthContext auth = mock(AuthContext.class);
        MockMvc mvc = mvc(auth);

        mvc.perform(get("/api/admin/deployments/logs/run_1"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.text").value("building\n"))
                .andExpect(jsonPath("$.data.truncated").value(false));

        verify(auth).require("deployments.read");
    }

    @Test
    void rejectsInvalidAttemptId() throws Exception {
        AuthContext auth = mock(AuthContext.class);

        mvc(auth)
                .perform(get("/api/admin/deployments/logs/run.bad"))
                .andExpect(status().isBadRequest());

        verify(auth).require("deployments.read");
    }

    private MockMvc mvc(AuthContext auth) {
        DeploymentStatusService service =
                new DeploymentStatusService(new ObjectMapper(), directory.toString());
        return MockMvcBuilders.standaloneSetup(new DeploymentStatusController(service, auth))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }
}
