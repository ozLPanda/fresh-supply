package kz.company.shop;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CompanyShopApplication {
    public static void main(String[] args) {
        SpringApplication.run(CompanyShopApplication.class, args);
    }
}
