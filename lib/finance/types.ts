export type AccountType = "checking" | "savings" | "credit";

export type InvestmentAccountType = "401k" | "roth_ira" | "brokerage" | "hsa";
export type AssetClass = "us_equity" | "international_equity" | "bonds" | "cash";

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
  kind?: "income" | "bill" | "subscription" | "transfer" | "investment";
  destinationAccountId?: string;
};

export type InvestmentAccount = {
  id: string;
  name: string;
  institution: string;
  type: InvestmentAccountType;
  taxTreatment: "tax_deferred" | "roth" | "taxable" | "hsa";
  currentValueCents: number;
  description: string;
};

export type Holding = {
  id: string;
  accountId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  marketValueCents: number;
};

export type PortfolioHistoryPoint = {
  month: string;
  valueCents: number;
  cumulativeContributionsCents: number;
};

export type InvestmentContribution = {
  id: string;
  accountId: string;
  name: string;
  annualPlanCents: number;
  cadence: "monthly" | "semi_monthly";
  amountCents: number;
  source: "payroll" | "employer" | "checking";
};

export type TaxLimitReference = {
  id: "401k" | "ira" | "hsa_self";
  year: 2026;
  limitCents: number;
  label: string;
  sourceUrl: string;
};

export type DemoDataset = {
  schemaVersion: 2;
  metadata: {
    seed: string;
    asOfDate: string;
    generatedAt: string;
    currency: "USD";
    timezone: "America/New_York";
    expectedDiningLastMonthCents: number;
    expectedNetWorthCents: number;
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
    grossAnnualIncomeCents: number;
    monthlyTakeHomeCents: number;
  };
  accounts: Account[];
  investmentAccounts: InvestmentAccount[];
  holdings: Holding[];
  portfolioHistory: PortfolioHistoryPoint[];
  investmentContributions: InvestmentContribution[];
  taxLimitReferences: TaxLimitReference[];
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

export type TransactionFilters = {
  startDate?: string;
  endDate?: string;
  search?: string;
  accountId?: string;
  categoryId?: string;
  type?: "all" | "expense" | "income" | "transfer";
  recurringOnly?: boolean;
  sort?: "newest" | "oldest" | "amount_high" | "amount_low";
  limit?: number;
};

export type CashFlowMonth = {
  month: string;
  label: string;
  status: "recorded" | "projected";
  incomeCents: number;
  committedCents: number;
  flexibleCents: number;
  investmentCents: number;
  internalTransferCents: number;
  netCents: number;
  events: ForecastEvent[];
};

export type CashFlowForecast = {
  days: 30 | 60 | 90;
  asOfDate: string;
  throughDate: string;
  monthlyTakeHomeCents: number;
  averageFlexibleSpendingCents: number;
  expectedMonthlySurplusCents: number;
  projectedLiquidCashCents: number;
  safeToSpendNowCents: number;
  lowestBalanceCents: number;
  lowestBalanceDate: string;
  months: CashFlowMonth[];
  runway: ForecastResult;
  scenario?: PurchaseScenarioResult;
};

export type PurchaseScenario = {
  date: string;
  upfrontCostCents: number;
  monthlyCostCents: number;
};

export type PurchaseScenarioResult = {
  status: "covered" | "tight" | "not_covered";
  scenario: PurchaseScenario;
  safeToSpendBeforeCents: number;
  safeToSpendAfterCents: number;
  monthlySurplusBeforeCents: number;
  monthlySurplusAfterCents: number;
  lowestBalanceBeforeCents: number;
  lowestBalanceAfterCents: number;
  reserveFloorCents: number;
  explanation: string;
};
