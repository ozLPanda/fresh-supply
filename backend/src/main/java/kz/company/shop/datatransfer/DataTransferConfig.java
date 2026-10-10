package kz.company.shop.datatransfer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

@Configuration
public class DataTransferConfig {
    @Bean
    FilterRegistrationBean<DataTransferMutationFilter> dataTransferMutationFilter(
            DataTransferBarrier barrier, ObjectMapper mapper) {
        var registration =
                new FilterRegistrationBean<>(new DataTransferMutationFilter(barrier, mapper));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 20);
        return registration;
    }
}
