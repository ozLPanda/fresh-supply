package kz.company.shop.procurement.entity;

/** Этап работы с поставщиком внутри проекта закупки. */
public enum ProcurementCompanyStatus {
    FOUND,
    AWAITING_DOCUMENTS,
    OFFER_RECEIVED,
    SELECTED,
    REJECTED
}
