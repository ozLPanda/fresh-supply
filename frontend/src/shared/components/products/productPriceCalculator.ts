export type ProductCalculatedPrices = {
  price: number;
  wholesalePrice: number;
  bulkWholesalePrice: number;
  incomingPrice: number;
};

export type ProductPriceCalculation =
  | { prices: ProductCalculatedPrices; error: null }
  | { prices: null; error: string | null };

const MAX_PRICE_CENTS = 99_999_999_999_999n; // PostgreSQL NUMERIC(14, 2).

/** Accept decimal money input, including the spaces used by AppMoneyInput. */
export function isProductPriceInputValid(input: string): boolean {
  const normalized = input.replace(/\s/g, "").replace(",", ".");
  return normalized === "" || /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized);
}

// Read the decimal representation instead of multiplying a binary float by 100.
// Round the incoming amount once, then apply markups to these integer cents.
function toCents(value: number): bigint {
  const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length + 2;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  return (digits + divisor / 2n) / divisor;
}

export function calculateProductPrices(incomingPrice: number | null): ProductPriceCalculation {
  if (incomingPrice === null) return { prices: null, error: null };
  if (!Number.isFinite(incomingPrice) || incomingPrice < 0) {
    return { prices: null, error: "Введите корректную положительную сумму." };
  }
  if (incomingPrice > Number(MAX_PRICE_CENTS) / 100) {
    return { prices: null, error: "Сумма слишком большая для расчёта цен." };
  }
  const incoming = toCents(incomingPrice);
  if (incoming === 0n) {
    return { prices: null, error: "Приходная цена должна быть не меньше 0,01 ₸." };
  }
  const retail = (incoming * 130n + 50n) / 100n;
  const wholesale = (incoming * 125n + 50n) / 100n;
  const bulkWholesale = (incoming * 120n + 50n) / 100n;
  if ([incoming, retail, wholesale, bulkWholesale].some((amount) => amount > MAX_PRICE_CENTS)) {
    return {
      prices: null,
      error: "Сумма слишком большая: рассчитанная цена превышает допустимую.",
    };
  }
  return {
    prices: {
      price: Number(retail) / 100,
      wholesalePrice: Number(wholesale) / 100,
      bulkWholesalePrice: Number(bulkWholesale) / 100,
      incomingPrice: Number(incoming) / 100,
    },
    error: null,
  };
}
