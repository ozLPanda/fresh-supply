package kz.company.shop.datatransfer;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DataTransferReconciliationControllerTest {
    private static final String TOKEN="test-native-merge-control-0000000000000000000001";
    @Test void rejectsMissingWrongAndRemoteTokensBeforeCallingBusinessLogic() throws Exception {
        var service=mock(DataTransferReconciliationService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new DataTransferReconciliationController(TOKEN,service,new DataTransferBarrier())).build();
        for(String path:new String[]{"preflight","apply"}) {
            mvc.perform(post("/__desktop/data-merge/"+path).contentType("application/json").content("{}")).andExpect(status().isForbidden());
            mvc.perform(post("/__desktop/data-merge/"+path).header("X-Ovoshi-Control","wrong").contentType("application/json").content("{}")).andExpect(status().isForbidden());
            mvc.perform(post("/__desktop/data-merge/"+path).header("X-Ovoshi-Control",TOKEN).contentType("application/json").content("{}")
                    .with(request->{request.setRemoteAddr("203.0.113.1");return request;})).andExpect(status().isForbidden());
        }
        verifyNoInteractions(service);
    }
    @Test void acceptsCurrentPrivateControlTokenOnLoopback() throws Exception {
        var service=mock(DataTransferReconciliationService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new DataTransferReconciliationController(TOKEN,service,new DataTransferBarrier())).build();
        mvc.perform(post("/__desktop/data-merge/preflight").header("X-Ovoshi-Control",TOKEN).contentType("application/json").content("{}"))
                .andExpect(status().isOk());verify(service).preflight(any());
        mvc.perform(post("/__desktop/data-merge/apply").header("X-Ovoshi-Control",TOKEN).contentType("application/json").content("{}"))
                .andExpect(status().isOk());verify(service).apply(any());
    }
    @Test void endpointBeanDoesNotExistInWebsiteProfile() {
        new ApplicationContextRunner().withUserConfiguration(DataTransferReconciliationController.class)
                .run(context->assertThat(context).doesNotHaveBean(DataTransferReconciliationController.class));
    }
}
