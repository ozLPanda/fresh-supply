package kz.company.shop.datatransfer;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class DataTransferBarrierTest {
    @Test
    void snapshotWaitsForExistingTransactionAndNewMutationsWaitForSnapshot() throws Exception {
        var barrier = new DataTransferBarrier();
        try (var executor = Executors.newSingleThreadExecutor()) {
            var mutation = barrier.mutation();
            var started = new CountDownLatch(1);
            var snapshot =
                    executor.submit(
                            () -> {
                                started.countDown();
                                try (var lease = barrier.snapshot()) {
                                    return true;
                                }
                            });
            assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(snapshot.isDone()).isFalse();
            mutation.close();
            assertThat(snapshot.get(2, TimeUnit.SECONDS)).isTrue();
            try (var lease = barrier.snapshot()) {
                var requested = new CountDownLatch(1);
                var queued =
                        executor.submit(
                                () -> {
                                    requested.countDown();
                                    try (var writing = barrier.mutation()) {
                                        return true;
                                    }
                                });
                assertThat(requested.await(1, TimeUnit.SECONDS)).isTrue();
                assertThat(queued.isDone()).isFalse();
            }
        }
    }
}
