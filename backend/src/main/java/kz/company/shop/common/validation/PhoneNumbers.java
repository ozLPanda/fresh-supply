package kz.company.shop.common.validation;

import kz.company.shop.common.exception.AppExceptions;

/** Canonical phone identity used by login, user editing and desktop bootstrap. */
public final class PhoneNumbers {
    private PhoneNumbers() {}

    public static String normalize(String value) {
        String digits = value == null ? "" : value.replaceAll("\\D", "");
        if (digits.startsWith("8")) digits = "7" + digits.substring(1);
        if (digits.length() == 10) digits = "7" + digits;
        if (digits.length() != 11 || !digits.startsWith("7")) {
            throw new AppExceptions.BadRequest("Укажите корректный номер телефона");
        }
        return "+" + digits;
    }
}
