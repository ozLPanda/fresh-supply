package kz.company.shop.orders.service;

import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.users.entity.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PendingOrderCustomerBindingService {
    private final OrderRepository orderRepository;

    public PendingOrderCustomerBindingService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Transactional
    public void bindRegisteredUser(User user) {
        String email = user.email == null ? null : user.email.trim().toLowerCase();
        orderRepository.bindPendingCustomerOrders(user.id, email, normalizePhone(user.phone));
    }

    public static String normalizePhone(String value) {
        if (value == null || value.isBlank()) return null;
        String digits = value.replaceAll("\\D", "");
        if (digits.length() < 7) return null;
        return digits.length() == 11 && (digits.startsWith("7") || digits.startsWith("8"))
                ? digits.substring(1)
                : digits;
    }
}
