package kz.company.shop.worktime;

import static kz.company.shop.worktime.WorkTimeDto.*;
import static org.assertj.core.api.Assertions.*;

import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.common.exception.AppExceptions;
import org.junit.jupiter.api.Test;

class WorkTimeServiceTest {
    @Test
    void calculatesMinutesExcludingBreaksAndRoundsOnlyDailyTotal() {
        int minutes =
                WorkTimeService.minutes(List.of(new Interval(780, 1025), new Interval(540, 720)));
        assertThat(minutes).isEqualTo(425);
        assertThat(WorkTimeService.amount(new BigDecimal("10000"), 480, minutes))
                .isEqualByComparingTo("8854.17");
        assertThat(WorkTimeService.amount(new BigDecimal("10000"), 360, minutes))
                .isEqualByComparingTo("11805.56");
        assertThat(WorkTimeService.amount(new BigDecimal("10000"), 480, 1))
                .isEqualByComparingTo("20.83");
    }

    @Test
    void rejectsOverlapsAndInvalidTimesButAllowsAdjacentIntervalsAndMidnight() {
        assertThatThrownBy(
                        () ->
                                WorkTimeService.minutes(
                                        List.of(new Interval(540, 720), new Interval(700, 780))))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(() -> WorkTimeService.minutes(List.of(new Interval(720, 540))))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(() -> WorkTimeService.minutes(List.of()))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(() -> WorkTimeService.minutes(List.of(new Interval(0, 1441))))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThat(WorkTimeService.minutes(List.of(new Interval(0, 720), new Interval(720, 1440))))
                .isEqualTo(1440);
    }
}
