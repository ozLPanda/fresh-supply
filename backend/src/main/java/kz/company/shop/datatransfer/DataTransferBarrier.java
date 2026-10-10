package kz.company.shop.datatransfer;

import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import kz.company.shop.common.exception.AppExceptions;
import org.springframework.stereotype.Component;

/** HTTP file mutations complete their database transactions before an export takes its snapshot. */
@Component
public class DataTransferBarrier {
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock(true);

    public Lease mutation() {
        return acquire(lock.readLock());
    }

    public Lease snapshot() {
        return acquire(lock.writeLock());
    }

    private Lease acquire(Lock candidate) {
        try {
            if (!candidate.tryLock(Duration.ofSeconds(30).toMillis(), TimeUnit.MILLISECONDS)) {
                throw new AppExceptions.BadRequest("Перенос данных выполняется. Повторите позже.");
            }
            return candidate::unlock;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new AppExceptions.BadRequest("Перенос данных прерван");
        }
    }

    public interface Lease extends AutoCloseable {
        @Override
        void close();
    }
}
