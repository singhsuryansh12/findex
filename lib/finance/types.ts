export type AccountType = "checking" | "savings" | "credit";

export type Account = {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  mask: string;
  openingBalanceCents: number;
  currentBalanceCents: number;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
};

export type Merchant = {
  id: string;
  name: string;
  categoryId: string;
};

export type Transaction = {
  id: string;
  accountId: string;
  merchantId: string;
  categoryId: string;
  postedOn: string;
  amountCents: number;
  status: "posted";
  recurringRuleId?: string;
  transferGroupId?: string;
};

export type RecurringRule = {
  id: string;
  name: string;
  merchantId: string;
  categoryId: string;
  accountId: string;
  amountCents: number;
  cadence: "monthly" | "semi_monthly" | "yearly";
  dayOfMonth?: number;
  daysOfMonth?: number[];
  monthOfYear?: number;
  cashImpact: boolean;
  active: boolean;
};

export type DemoDataset = {
  schemaVersion: 1;
  metadata: {
    seed: string;
    asOfDate: string;
    generatedAt: string;
    currency: "USD";
    timezone: "America/New_York";
    expectedDiningLastMonthCents: number;
  };
  persona: {
    id: string;
    name: string;
    firstName: string;
    initials: string;
    role: string;
    location: string;
    age: number;
    reserveFloorCents: number;
  };
  accounts: Account[];
  categories: Category[];
  merchants: Merchant[];
  recurringRules: RecurringRule[];
  transactions: Transaction[];
};

export type ForecastEvent = {
  id: string;
  date: string;
  name: string;
  amountCents: number;
  kind: "income" | "liability";
};

export type ForecastPoint = {
  date: string;
  dayLabel: string;
  projectedBalanceCents: number;
  safeToSpendCents: number;
  events: ForecastEvent[];
};

export type ForecastResult = {
  asOfDate: string;
  throughDate: string;
  reserveFloorCents: number;
  safeToSpendNowCents: number;
  lowestBalanceCents: number;
  lowestBalanceDate: string;
  points: ForecastPoint[];
  events: ForecastEvent[];
};

export type SpendingSummary = {
  categoryId?: string;
  categoryName: string;
  startDate: string;
  endDate: string;
  amountCents: number;
  count: number;
  topMerchants: Array<{ name: string; amountCents: number }>;
};

export type MonthlySpending = {
  month: string;
  label: string;
  incomeCents: number;
  spendingCents: number;
  diningCents: number;
};

