package kz.company.shop.orders.ai;

import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderAssistantMemoryRepository extends JpaRepository<OrderAssistantMemory, UUID> {
    List<OrderAssistantMemory> findTop200ByOwnerIdOrderByUpdatedAtDesc(Long ownerId);

    Optional<OrderAssistantMemory> findByOwnerIdAndKindAndSource(
            Long ownerId, String kind, String source);
}
