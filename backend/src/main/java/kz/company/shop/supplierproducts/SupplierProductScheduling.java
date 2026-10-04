package kz.company.shop.supplierproducts;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class SupplierProductScheduling {
    @Bean("taskScheduler")
    public ThreadPoolTaskScheduler applicationScheduler() {
        var scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("application-scheduled-");
        return scheduler;
    }

    @Bean("supplierImportScheduler")
    public ThreadPoolTaskScheduler supplierImportScheduler() {
        var scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("supplier-import-");
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }
}
