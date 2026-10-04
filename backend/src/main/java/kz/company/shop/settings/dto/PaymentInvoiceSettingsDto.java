package kz.company.shop.settings.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.AssertTrue;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Locale;

/** Shared supplier details for payment invoices; never exposed through storefront settings. */
public record PaymentInvoiceSettingsDto(
        @NotBlank @Size(max = 240) String supplierName,
        @NotBlank @Pattern(regexp = "[0-9]{12}", message = "ИИН/БИН должен содержать 12 цифр") String supplierTaxId,
        @NotBlank @Size(max = 240) String bankName,
        @NotBlank @Pattern(regexp = "KZ[A-Z0-9]{18}", message = "ИИК должен содержать KZ и 18 символов") String iban,
        @NotBlank @Pattern(regexp = "[A-Z0-9]{8}([A-Z0-9]{3})?", message = "БИК должен содержать 8 или 11 символов") String bic,
        @NotBlank @Pattern(regexp = "[0-9]{2}", message = "КБе должен содержать 2 цифры") String beneficiaryCode,
        @NotBlank @Pattern(regexp = "[0-9]{3}", message = "КНП должен содержать 3 цифры") String paymentPurposeCode,
        @Size(max = 500) String contract,
        @Size(max = 240) String executor,
        @Size(max = 2000) String paymentTerms) {

    public PaymentInvoiceSettingsDto {
        supplierName = clean(supplierName);
        supplierTaxId = clean(supplierTaxId);
        bankName = clean(bankName);
        iban = clean(iban).replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        bic = clean(bic).toUpperCase(Locale.ROOT);
        beneficiaryCode = clean(beneficiaryCode);
        paymentPurposeCode = clean(paymentPurposeCode);
        contract = clean(contract);
        executor = clean(executor);
        paymentTerms = clean(paymentTerms);
    }

    public static PaymentInvoiceSettingsDto defaults() {
        return new PaymentInvoiceSettingsDto(
                "ИП \"GASTROFLOW\"", "910818451048", "АО \"KASPI BANK\"",
                "KZ64722S000056725357", "CASPKZKA", "19", "710", "Без договора",
                "Гайсумов Р.М.",
                "Внимание! Оплата данного счета означает согласие с условиями поставки товара.\n"
                        + "Уведомление об оплате обязательно, в противном случае не гарантируется наличие "
                        + "товара на складе. Товар отпускается по факту прихода денег на р/с Поставщика, "
                        + "самовывозом, при наличии доверенности и документов удостоверяющих личность.");
    }

    @JsonIgnore
    @AssertTrue(message = "Проверьте ИИК: неверная структура или контрольное число IBAN")
    public boolean isValidIban() {
        if (!iban.matches("KZ[0-9]{5}[A-Z0-9]{13}")) return false;
        String rearranged = iban.substring(4) + iban.substring(0, 4);
        int remainder = 0;
        for (char c : rearranged.toCharArray()) {
            int value = Character.isDigit(c) ? c - '0' : c - 'A' + 10;
            remainder = (remainder * (value < 10 ? 10 : 100) + value) % 97;
        }
        return remainder == 1;
    }

    private static String clean(String value) { return value == null ? "" : value.trim(); }
}
