export type ApiResponse<T> = { success: boolean; message?: string; data: T };
export type PagedResult<T> = {
  items: T[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
};

export type ProductCatalogAnalytics = {
  totalItems: number;
  withoutCategory: number;
  activeItems: number;
  withoutImages: number;
  withoutIncomingPrice: number;
};

export type ProductImage = {
  id: number;
  fileName?: string;
  filePath: string;
  originalFileName: string;
  sortOrder?: number;
  mainImage: boolean;
  contentHash?: string | null;
};

export type Product = {
  id?: number;
  sku: string;
  nameRu: string;
  nameKk: string;
  price: number | null;
  wholesalePrice?: number;
  bulkWholesalePrice?: number;
  skoPrice?: number;
  /** Внутренняя цена ГСКО; API не возвращает её клиентам магазина. */
  gskoPrice?: number;
  /** Внутренняя приходная цена; API возвращает её только пользователям с доступом к товарам. */
  incomingPrice?: number;
  categoryId?: number;
  categoryNameRu?: string;
  active: boolean;
  madeToOrder?: boolean;
  deliveryDaysFrom?: number | null;
  deliveryDaysTo?: number | null;
  shortDescriptionRu?: string;
  descriptionRu?: string;
  images?: ProductImage[];
  /** Розничная цена до персональной скидки текущего покупателя. */
  regularPrice?: number | null;
  personalDiscountPercent?: number | null;
};

export type AlibabaSourcingConfig = {
  productId?: number;
  enabled: boolean;
  searchQuery: string;
  minimumOrderQuantity?: number | null;
  minimumCompanyAgeYears?: number | null;
  selectedOfferId?: number | null;
  selectedOffer?: AlibabaSourcingResult | null;
};

export type AlibabaSourcingRunStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

export type AlibabaSourcingResult = {
  id: number;
  position?: number;
  productName?: string | null;
  companyName: string;
  companyCountry?: string | null;
  companyAgeYears?: number | null;
  minimumOrderQuantity?: number | null;
  price?: number | null;
  priceFrom?: number | null;
  priceTo?: number | null;
  currency?: string | null;
  productUrl?: string | null;
  companyUrl?: string | null;
  verifiedSupplier?: boolean | null;
  rating?: number | null;
  reviewCount?: number | null;
  description?: string | null;
  selected: boolean;
};

export type AlibabaSourcingRun = {
  id: string;
  status: AlibabaSourcingRunStatus;
  searchQuery?: string;
  minimumOrderQuantity?: number | null;
  minimumCompanyAgeYears?: number | null;
  createdAt?: string;
  completedAt?: string;
  errorMessage?: string | null;
  results: AlibabaSourcingResult[];
};

export type Category = {
  id?: number;
  parentId?: number | null;
  nameRu: string;
  nameKk: string;
  parentNameRu?: string | null;
  slug: string;
  descriptionRu?: string;
  descriptionKk?: string;
  imageFileName?: string;
  imageOriginalFileName?: string;
  imageFilePath?: string;
  imageContentHash?: string | null;
  sortOrder: number;
  active: boolean;
  children?: Category[];
};

export type User = {
  id?: number;
  name: string;
  email?: string | null;
  phone?: string;
  active?: boolean;
  personalDiscountPercent?: number | null;
  password?: string;
  roleIds?: number[];
  permissions?: string[];
};

export type CurrentUser = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string;
  permissions: string[];
  adminAccess: boolean;
  balance: number;
  personalDiscountPercent?: number | null;
};

export type CartItem = {
  id: number;
  productId: number;
  sku: string;
  nameRu: string;
  price: number;
  regularPrice?: number;
  wholesalePrice?: number;
  wholesale?: boolean;
  available: boolean;
  madeToOrder?: boolean;
  quantity: number;
  lineTotal: number;
  imagePath?: string;
  imageContentHash?: string | null;
  personalDiscountPercent?: number | null;
  priceTier?: PriceTier;
};

export type PriceTier = "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO";

export type CartPriceTier = {
  tier: PriceTier;
  permissionAvailable: boolean;
  available: boolean;
  subtotal: number;
  threshold: number | null;
  remaining: number;
  missingPriceItemCount: number;
};

export type Cart = {
  items: CartItem[];
  itemCount: number;
  total: number;
  priceTier?: PriceTier;
  priceTiers?: CartPriceTier[];
};

export type TemporaryInvoicePriceOption = {
  priceTier: PriceTier;
  total: number;
  profit: number;
};

export type TemporaryInvoicePreview = {
  priceOptions: TemporaryInvoicePriceOption[];
  mostFavorablePriceTier: PriceTier;
  mostFavorableTotal: number;
};

export type WalletTransaction = {
  id: number;
  type: "CREDIT" | "DEBIT" | "REFUND" | "PRICE_DEBIT" | "PRICE_REFUND";
  amount: number;
  balanceAfter: number;
  orderId?: string;
  actorUserId?: number;
  comment: string;
  createdAt: string;
};

export type Wallet = {
  balance: number;
  transactions: WalletTransaction[];
};

export type OrderItem = {
  id: number;
  productId?: number;
  /** Товар был доступен только под заказ на момент оформления. */
  madeToOrder: boolean;
  sku: string;
  nameRu: string;
  unitPrice: number;
  confirmedUnitPrice: number;
  wholesale: boolean;
  priceTier?: PriceTier;
  quantity: number;
  assembled: boolean;
  checked: boolean;
  lineTotal: number;
  confirmedLineTotal: number;
  /** Количество, отпущенное несмотря на подтверждённый дефицит склада. */
  stockShortageQuantity?: number;
  stockShortageReleasedByUserId?: number | null;
  stockShortageReleasedByUserName?: string | null;
  stockShortageReleasedAt?: string | null;
  stockShortageComment?: string | null;
};

export type OrderReturnItem = {
  orderItemId: number;
  orderedQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  originalAmount: number;
  returnedAmount: number;
  remainingAmount: number;
};

export type OrderReturnDocument = {
  id: string;
  documentNumber?: string | null;
  postedAt: string;
  total: number;
  lines: Array<{
    orderItemId: number;
    productName: string;
    quantity: number;
    amount: number;
  }>;
};

export type OrderReturnSummary = {
  originalTotal: number;
  returnedTotal: number;
  remainingTotal: number;
  items: OrderReturnItem[];
  documents: OrderReturnDocument[];
};

export type OrderReturnStatistic = {
  orderId: string;
  returnedQuantity: number;
  returnedTotal: number;
};

export type Order = {
  /** Internal, globally unique UUIDv7 used in API paths and relations. */
  id: string;
  /** Human-readable order number: YYYYMMDD followed by the daily sequence. */
  displayCode: string;
  userId?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  status: "NEW" | "PRICE_REVIEW" | "PROCESSING" | "READY_FOR_PICKUP" | "COMPLETED" | "CANCELLED";
  paymentStatus: "PENDING" | "PAID" | "REFUNDED";
  paymentMethod: "BALANCE" | "ON_RECEIPT" | "CASH" | "CASHLESS" | "KASPI_STORE" | "MIXED";
  cashPaymentAmount?: number | null;
  cashlessPaymentAmount?: number | null;
  cashlessPaymentType?: "TRANSFER" | "CARD" | "QR" | null;
  transferPaymentAmount?: number | null;
  cardPaymentAmount?: number | null;
  qrPaymentAmount?: number | null;
  fulfillmentType: "PICKUP" | "DELIVERY";
  address?: string;
  contactPhone?: string | null;
  comment?: string;
  printComment?: string | null;
  wholesale: boolean;
  priceTier?: PriceTier;
  priceSourceDocumentId?: string | null;
  priceSourceDocumentNumber?: string | null;
  priceSourceDocumentPriceType?: string | null;
  priceSourceDocumentDeleted?: boolean;
  createdByUserId?: number | null;
  assemblyAssigneeId?: number;
  assemblyAssigneeName?: string;
  checkingAssigneeId?: number;
  checkingAssigneeName?: string;
  assembledItems: number;
  checkedItems: number;
  total: number;
  paidTotal: number;
  createdAt: string;
  /** Until this moment the currently available stock is held for the order. */
  reservationExpiresAt?: string | null;
  items: OrderItem[];
};

export type DashboardMetric = {
  value: number;
  trendPercent?: number;
};

export type DashboardRevenuePoint = {
  key: string;
  label: string;
  revenue: number;
  netProfit: number | null;
  orders: number;
};

export type DashboardRecentProduct = {
  id: number;
  sku: string;
  name: string;
  price: number;
  active: boolean;
  createdAt: string;
};

export type DashboardAuditItem = {
  id: number;
  actorName: string;
  action: string;
  entityType: string;
  entityId?: number | string;
  description: string;
  createdAt: string;
};

export type AuditLog = {
  id: number;
  actorUserId?: number | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  description: string;
  createdAt: string;
};

export type DashboardData = {
  period: 7 | 30 | 90;
  newOrders: DashboardMetric;
  activeProducts: number;
  activeCategories: number;
  productViews: DashboardMetric;
  revenue: DashboardRevenuePoint[];
  recentProducts: DashboardRecentProduct[];
  recentActions: DashboardAuditItem[];
  productsWithoutImages: number;
  importErrors: number;
};

export type DeploymentHistoryItem = {
  revision: string;
  state: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  attemptId: string | null;
};

export type DeploymentStatus = {
  state: "idle" | "running" | "succeeded" | "failed" | "unavailable";
  deployedRevision: string | null;
  targetRevision: string | null;
  checkedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attemptId: string | null;
  stage: string | null;
  history: DeploymentHistoryItem[];
};

export type DeploymentLog = {
  text: string;
  truncated: boolean;
};

export type SalesAnalyticsGroupBy = "day" | "week" | "month" | "year";

export type SalesAnalyticsTotals = {
  revenue: number;
  /** Revenue minus known incoming costs; positions without a cost are excluded from profit. */
  netProfit: number | null;
  orders: number;
  items: number;
};

export type SalesAnalyticsPoint = SalesAnalyticsTotals & {
  key: string;
  label: string;
};

export type SalesAnalyticsBreakdownItem = SalesAnalyticsTotals & {
  id: number | null;
  name: string;
  series: SalesAnalyticsPoint[];
};

export type SalesAnalyticsData = {
  from: string;
  to: string;
  groupBy: SalesAnalyticsGroupBy;
  totals: SalesAnalyticsTotals;
  series: SalesAnalyticsPoint[];
  employees: SalesAnalyticsBreakdownItem[];
  products: SalesAnalyticsBreakdownItem[];
  categories: SalesAnalyticsBreakdownItem[];
  months: SalesAnalyticsPoint[];
  weekdays: SalesAnalyticsPoint[];
  activity: {
    weekday: number;
    hour: number;
    orders: number;
    items: number;
    revenue: number;
    netProfit: number;
  }[];
  timeZone: string;
};

export type NotificationItem = {
  id: number;
  type: "NEW_ORDER" | "ORDER_STATUS_CHANGED" | "ORDER_PRICE_REVIEW" | "ORDER_PRICE_CONFIRMED";
  title: string;
  message: string;
  /** Internal UUIDv7 of the related order, when this is an order notification. */
  orderId?: string;
  /** Human-readable order number for notification text. */
  displayCode?: string;
  actionUrl?: string;
  read: boolean;
  createdAt: string;
};

export type NotificationList = {
  items: NotificationItem[];
  unreadCount: number;
};

export type Role = {
  id?: number;
  code: string;
  nameRu: string;
  nameKk?: string;
  active: boolean;
  permissionIds?: number[];
  permissions?: string[];
};

export type Permission = {
  id: number;
  code: string;
  entityName: string;
  actionName: string;
  nameRu: string;
};

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN";
export type ReviewMessageAuthorType = "ADMIN" | "CUSTOMER";

export type ReviewImage = {
  id: number;
  fileName: string;
  filePath: string;
  originalFileName: string;
  fileSize: number;
  sortOrder: number;
};

export type ReviewMessage = {
  id: number;
  userId?: number;
  authorName: string;
  authorType: ReviewMessageAuthorType;
  content: string;
  createdAt: string;
};

export type Review = {
  id: number;
  productId: number;
  productName: string;
  userId: number;
  authorName: string;
  rating: number;
  content: string;
  status: ReviewStatus;
  verified: boolean;
  verifiedOrderId?: string;
  createdAt: string;
  images: ReviewImage[];
  messages: ReviewMessage[];
};

export type ReviewSummary = {
  averageRating: number;
  totalReviews: number;
  verifiedReviews: number;
};
