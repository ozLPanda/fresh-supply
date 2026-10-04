export type ProcurementStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "READY_FOR_REVIEW"
  | "READY_FOR_PAYMENT"
  | "PAID"
  | "REWORK";

export type ProcurementLink = {
  id?: number;
  name: string;
  url: string;
  sortOrder?: number;
};

export type ProcurementFile = {
  id: number;
  displayName: string;
  fileName?: string;
  filePath: string;
  originalFileName: string;
  contentType?: string | null;
  fileSize?: number;
  createdAt: string;
};

export type ProcurementCompanyNote = {
  id: number;
  content: string;
  authorUserId?: number | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export type ProcurementCompanyStatus =
  | "FOUND"
  | "AWAITING_DOCUMENTS"
  | "OFFER_RECEIVED"
  | "SELECTED"
  | "REJECTED";

export type ProcurementCompany = {
  id: number;
  name: string;
  companyStatus?: ProcurementCompanyStatus | null;
  decisionComment?: string | null;
  price?: number | null;
  priceCurrency?: "KZT" | "USD" | "CNY" | null;
  market?: string | null;
  marketSinceYear?: number | null;
  reviewsFromYear?: number | null;
  reviewsToYear?: number | null;
  comment?: string | null;
  links: ProcurementLink[];
  files: ProcurementFile[];
  createdAt?: string;
  updatedAt?: string;
};

export type ProcurementPayment = {
  id: number;
  amount: number;
  currency: string;
  paidAt: string;
  comment?: string | null;
  createdAt?: string;
};

export type ProcurementStatusHistory = {
  id: number;
  oldStatus?: ProcurementStatus | null;
  newStatus: ProcurementStatus;
  comment?: string | null;
  actorName: string;
  createdAt: string;
};

export type ProcurementProject = {
  id: number;
  name: string;
  purchaseInformation?: string | null;
  status: ProcurementStatus;
  companies: ProcurementCompany[];
  files: ProcurementFile[];
  payments: ProcurementPayment[];
  createdAt: string;
  updatedAt: string;
};

export type ProcurementProjectSummary = Pick<
  ProcurementProject,
  "id" | "name" | "status" | "createdAt" | "updatedAt"
> & {
  companiesCount: number;
  totalPaid?: number | null;
};

export type ProcurementProjectInput = {
  name: string;
  purchaseInformation?: string | null;
};

export type ProcurementCompanyInput = Omit<
  ProcurementCompany,
  "id" | "files" | "createdAt" | "updatedAt"
>;
export type ProcurementPaymentInput = Omit<ProcurementPayment, "id" | "createdAt">;
