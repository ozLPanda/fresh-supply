package kz.company.shop.orders.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import kz.company.shop.orders.ai.OrderAssistantDto.Chat;
import org.junit.jupiter.api.Test;

class OrderAssistantAliasApprovalTest {
    private static final String ALIAS = "Викинг";
    private static final String BUYER = "ТОО Север";

    @Test
    void explicitNamedMappingsAreAcceptedAsCompleteStatements() {
        for (String message :
                List.of(
                        "Викинг — это ТОО Север",
                        "Викинг = ТОО Север.",
                        "Викинг — ТОО Север",
                        "Викинг - покупатель ТОО Север",
                        "Викинг -> ТОО Север",
                        "Покупатель Викинг это ТОО Север!",
                        "  ВИКИНГ\u00a0 —  это  ТОО   СЕВЕР  ")) {
            assertThat(OrderAssistantAliasApproval.explicitMapping(ALIAS, BUYER, message))
                    .as(message)
                    .isTrue();
        }
        assertThat(OrderAssistantAliasApproval.explicitMapping("Ёлка", BUYER, "елка = ТОО Север"))
                .isTrue();
    }

    @Test
    void bareRequestsQuotesQuestionsNegationsAndConditionsNeverAuthorize() {
        for (String message :
                List.of(
                        "Викинг",
                        "Викинг\nКартофель 5 кг",
                        "Викинг\nТОО Север",
                        "Викинг — это ТОО Север?",
                        "Викинг — это не ТОО Север",
                        "Викинг — возможно ТОО Север",
                        "Возможно, Викинг — это ТОО Север",
                        "Если Викинг — это ТОО Север, добавь его",
                        "Пример: Викинг — это ТОО Север",
                        "\"Викинг — это ТОО Север\"",
                        "«Викинг — это ТОО Север»",
                        "Не запоминай: Викинг — это ТОО Север",
                        "Викинг — это ТОО Север, но не сохраняй название",
                        "Викинг — это ТОО Север\nПока не добавляй тег",
                        "Гараж — это ТОО Север",
                        "Викинг — это ТОО Юг")) {
            assertThat(OrderAssistantAliasApproval.explicitMapping(ALIAS, BUYER, message))
                    .as(message)
                    .isFalse();
        }
    }

    @Test
    void literalEntityNamesCannotInjectRegexAndMayContainTheirOwnQuotes() {
        assertThat(
                        OrderAssistantAliasApproval.explicitMapping(
                                "Викинг (центр)",
                                "ТОО \"Север\"",
                                "Викинг (центр) — это ТОО \"Север\""))
                .isTrue();
        assertThat(
                        OrderAssistantAliasApproval.explicitMapping(
                                ".*", BUYER, "Викинг — это ТОО Север"))
                .isFalse();
        assertThat(
                        OrderAssistantAliasApproval.explicitMapping(
                                ALIAS, "ТОО .*", "Викинг — это ТОО Север"))
                .isFalse();
    }

    @Test
    void modelCannotHideNegativeOrConditionalInstructionsInsideTheProposedAlias() {
        for (String alias :
                List.of(
                        "Не запоминай: Викинг",
                        "Если Викинг",
                        "Пример: Викинг",
                        "Возможно Викинг")) {
            assertThat(
                            OrderAssistantAliasApproval.explicitMapping(
                                    alias, BUYER, alias + " — это " + BUYER))
                    .as(alias)
                    .isFalse();
        }
        assertThat(
                        OrderAssistantAliasApproval.explicitMapping(
                                "\"Викинг", BUYER, "\"Викинг — это ТОО Север"))
                .isFalse();
    }

    @Test
    void shortApprovalRequiresTheExactPriorDedicatedQuestion() {
        List<Chat> history =
                List.of(new Chat("assistant", OrderAssistantAliasApproval.question(ALIAS, BUYER)));
        for (String message :
                List.of("да", " ДА! ", "подтверждаю", "да, верно.", "Да, подтверждаю")) {
            assertThat(OrderAssistantAliasApproval.confirmed(ALIAS, BUYER, history, message))
                    .as(message)
                    .isTrue();
        }
        assertThat(OrderAssistantAliasApproval.confirmed(ALIAS, BUYER, List.of(), "да")).isFalse();
        assertThat(OrderAssistantAliasApproval.confirmed(ALIAS, BUYER, null, "да")).isFalse();
        assertThat(OrderAssistantAliasApproval.confirmed(ALIAS, "ТОО Юг", history, "да")).isFalse();
        assertThat(OrderAssistantAliasApproval.confirmed("Гараж", BUYER, history, "да")).isFalse();
    }

    @Test
    void interveningQuestionsUserEchoAndExtraTextDoNotCountAsDedicatedQuestion() {
        String question = OrderAssistantAliasApproval.question(ALIAS, BUYER);
        for (List<Chat> history :
                List.of(
                        List.of(
                                new Chat("assistant", question),
                                new Chat("assistant", "Картофеля 5 кг?")),
                        List.of(new Chat("user", question)),
                        List.of(new Chat("assistant", question + " Заодно заменить картофель?")),
                        List.of(new Chat("assistant", "Подтверждаете покупателя?")))) {
            assertThat(OrderAssistantAliasApproval.confirmed(ALIAS, BUYER, history, "да"))
                    .isFalse();
        }
    }

    @Test
    void negativeConditionalAndQuotedAnswersCannotApprove() {
        List<Chat> history =
                List.of(new Chat("assistant", OrderAssistantAliasApproval.question(ALIAS, BUYER)));
        for (String message :
                List.of(
                        "нет",
                        "да, но не Север",
                        "да?",
                        "возможно",
                        "да, наверное",
                        "\"да\"",
                        "не подтверждаю",
                        "да\nне сохраняй")) {
            assertThat(OrderAssistantAliasApproval.confirmed(ALIAS, BUYER, history, message))
                    .as(message)
                    .isFalse();
        }
    }

    @Test
    void onlyUnambiguousNegativeResponsesRejectThePendingSuggestion() {
        for (String message :
                List.of(
                        "нет",
                        " НЕТ. ",
                        "не надо",
                        "не нужно!",
                        "не сохраняй",
                        "не запоминай",
                        "отмена",
                        "нет, не надо")) {
            assertThat(OrderAssistantAliasApproval.rejected(message)).as(message).isTrue();
        }
        for (String message :
                List.of(
                        "нет, Викинг это ТОО Юг",
                        "нет?",
                        "\"нет\"",
                        "да",
                        "не нужно менять количество")) {
            assertThat(OrderAssistantAliasApproval.rejected(message)).as(message).isFalse();
        }
    }

    @Test
    void missingNamesOrMessagesNeverAuthorize() {
        assertThat(OrderAssistantAliasApproval.explicitMapping(null, BUYER, " = ТОО Север"))
                .isFalse();
        assertThat(OrderAssistantAliasApproval.explicitMapping(ALIAS, " ", "Викинг = ")).isFalse();
        assertThat(OrderAssistantAliasApproval.explicitMapping(ALIAS, BUYER, null)).isFalse();
        assertThat(OrderAssistantAliasApproval.rejected(null)).isFalse();
    }
}
