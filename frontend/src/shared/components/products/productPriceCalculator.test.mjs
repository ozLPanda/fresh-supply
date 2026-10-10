import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateProductPrices, isProductPriceInputValid } from "./productPriceCalculator.ts";

test("calculates the three markups and preserves rounded incoming cost", () => {
  assert.deepEqual(calculateProductPrices(100).prices, {
    price: 130,
    wholesalePrice: 125,
    bulkWholesalePrice: 120,
    incomingPrice: 100,
  });
  assert.deepEqual(calculateProductPrices(123.45).prices, {
    price: 160.49,
    wholesalePrice: 154.31,
    bulkWholesalePrice: 148.14,
    incomingPrice: 123.45,
  });
});

test("rounds decimal halves correctly without binary floating-point drift", () => {
  assert.equal(calculateProductPrices(1.005).prices.incomingPrice, 1.01);
  assert.equal(calculateProductPrices(10.075).prices.incomingPrice, 10.08);
  assert.equal(calculateProductPrices(0.1 + 0.2).prices.incomingPrice, 0.3);
  assert.equal(calculateProductPrices(0.1).prices.wholesalePrice, 0.13);
  assert.deepEqual(calculateProductPrices(0.005).prices, {
    price: 0.01,
    wholesalePrice: 0.01,
    bulkWholesalePrice: 0.01,
    incomingPrice: 0.01,
  });
});

test("does not calculate empty, negative, nonfinite, zero or below-cent prices", () => {
  assert.deepEqual(calculateProductPrices(null), { prices: null, error: null });
  for (const value of [-1, NaN, Infinity, -Infinity, 0, 0.004, 1e-100]) {
    const result = calculateProductPrices(value);
    assert.equal(result.prices, null);
    assert.ok(result.error);
  }
});

test("checks generated prices against the database precision boundary", () => {
  const boundary = calculateProductPrices(769230769230.76);
  assert.equal(boundary.prices.price, 999999999999.99);
  assert.equal(boundary.prices.incomingPrice, 769230769230.76);
  for (const value of [769230769230.77, 999999999999.99, 1e12, Number.MAX_VALUE]) {
    assert.equal(calculateProductPrices(value).prices, null);
    assert.ok(calculateProductPrices(value).error);
  }
});

test("accepts ordinary decimal money but rejects JavaScript number syntax and bad paste", () => {
  for (const input of ["", "123", "123,45", "123.45", "1 234,56", "0,01", ".5"]) {
    assert.equal(isProductPriceInputValid(input), true, input);
  }
  for (const input of ["-1", "Infinity", "NaN", "1e5", "0x10", "12руб", "12,3,4", "."]) {
    assert.equal(isProductPriceInputValid(input), false, input);
  }
});
