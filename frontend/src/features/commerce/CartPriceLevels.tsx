import { Check, LockKeyhole, TrendingUp } from "lucide-react";
import { CartPriceTier, PriceTier } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import "./CartPriceLevels.css";

const TIER_LABELS: Record<PriceTier, string> = {
  RETAIL: "Розница",
  WHOLESALE: "Опт",
  BULK_WHOLESALE: "Крупный опт",
  SKO: "СКО",
};

function progressPercent(tier: CartPriceTier) {
  if (!tier.threshold || tier.threshold <= 0) return tier.available ? 100 : 0;
  return Math.min(100, Math.max(0, (tier.subtotal / tier.threshold) * 100));
}

function tierDescription(tier: CartPriceTier, appliedTier: PriceTier) {
  if (tier.tier === appliedTier) return "Цена применяется при оформлении";
  if (!tier.permissionAvailable) return "Недоступно по вашим правам";
  if (tier.missingPriceItemCount > 0) {
    return `Нет цены уровня у ${tier.missingPriceItemCount} ${tier.missingPriceItemCount === 1 ? "позиции" : "позиций"}`;
  }
  if (tier.available) return "Уровень доступен";
  if (tier.threshold) return `Осталось ${formatMoney(tier.remaining)}`;
  return "Добавьте товары в корзину";
}

export function CartPriceLevels({
  tiers,
  appliedTier,
}: {
  tiers: CartPriceTier[];
  appliedTier: PriceTier;
}) {
  return (
    <section className="cart-price-levels" aria-labelledby="cart-price-levels-title">
      <div className="cart-price-levels__heading">
        <div>
          <span className="cart-price-levels__eyebrow">Уровни цен</span>
          <h2 id="cart-price-levels-title">Выгода по корзине</h2>
        </div>
        <span className="cart-price-levels__current">
          <TrendingUp size={16} aria-hidden="true" />
          Сейчас: {TIER_LABELS[appliedTier]}
        </span>
      </div>

      <div className="cart-price-levels__list">
        {tiers.map((tier) => {
          const state =
            tier.tier === appliedTier ? "active" : tier.available ? "available" : "locked";
          const percent = progressPercent(tier);
          return (
            <article key={tier.tier} className={`cart-price-levels__tier is-${state}`}>
              <div className="cart-price-levels__tier-head">
                <span className="cart-price-levels__tier-icon" aria-hidden="true">
                  {tier.available ? <Check size={15} /> : <LockKeyhole size={14} />}
                </span>
                <strong>{TIER_LABELS[tier.tier]}</strong>
              </div>
              {tier.threshold ? (
                <>
                  <div
                    className="cart-price-levels__progress"
                    aria-label={`Прогресс уровня ${TIER_LABELS[tier.tier]}: ${Math.round(percent)}%`}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <div className="cart-price-levels__amounts">
                    <span>{formatMoney(tier.subtotal)}</span>
                    <span>{formatMoney(tier.threshold)}</span>
                  </div>
                </>
              ) : (
                <div className="cart-price-levels__progress cart-price-levels__progress--plain">
                  <span style={{ width: tier.available ? "100%" : "0%" }} />
                </div>
              )}
              <p>{tierDescription(tier, appliedTier)}</p>
            </article>
          );
        })}
      </div>
      <p className="cart-price-levels__note">
        Для перехода на уровень у каждой позиции должна быть указана цена этого уровня.
      </p>
    </section>
  );
}
