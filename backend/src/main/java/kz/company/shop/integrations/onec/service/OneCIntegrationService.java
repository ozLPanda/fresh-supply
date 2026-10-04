package kz.company.shop.integrations.onec.service;

import kz.company.shop.integrations.onec.dto.OneCStatusDto;
import org.springframework.stereotype.Service;

@Service
public class OneCIntegrationService {
    public OneCStatusDto status() {
        return new OneCStatusDto("planned", "Интеграционный слой 1С подготовлен.");
    }
}
