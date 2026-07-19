import { format, getDaysInMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import demoDataJson from "@/data/demo-data.json";
import { asDate, compactDate, dateRange, formatISODate, previousCalendarMonth } from "./dates";
import type {
  AssetClass,
  CashFlowForecast,
  DemoDataset,
  ForecastEvent,
  ForecastResult,
  MonthlySpending,
  PurchaseScenario,
  PurchaseScenarioResult,
  RecurringRule,
  SpendingSummary,
  Transaction,
  TransactionFilters,
} from "./types";

export const demoData = demoDataJson as DemoDataset;

const SPENDING_EXCLUSIONS = new Set(["income", "transfer"]);

export function formatMoney(cents: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(cents / 100);
}

export function formatMoneyPrecise(cents: number): string {
  return formatMoney(cents, 2);
}

export function getCategoryName(categoryId?: string): string {
  if (!categoryId) return "All spending";
  return demoData.categories.find((category) => category.id === categoryId)?.name ?? categoryId;
}

export function getMerchantName(merchantId: string): string {
  return demoData.merchants.find((merchant) => merchant.id === merchantId)?.name ?? merchantId;
}

export function isSpending(transaction: Transaction): boolean {
  return transaction.amountCents < 0 && !SPENDING_EXCLUSIONS.has(transaction.categoryId);
}

export function getSpendingSummary(
  startDate: string,
  endDate: string,
  categoryId?: string,
): SpendingSummary {
  const matching = demoData.transactions.filter(
    (transaction) =>
      transaction.postedOn >= startDate &&
      transaction.postedOn <= endDate &&
      isSpending(transaction) &&
      (!categoryId || transaction.categoryId === categoryId),
  );

  const merchantTotals = new Map<string, number>();
  for (const transaction of matching) {
    merchantTotals.set(
      transaction.merchantId,
      (merchantTotals.get(transaction.merchantId) ?? 0) + Math.abs(transaction.amountCents),
    );
  }

  return {
    categoryId,
    categoryName: getCategoryName(categoryId),
    startDate,
    endDate,
    amountCents: matching.reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0),
    count: matching.length,
    topMerchants: [...merchantTotals.entries()]
      .map(([merchantId, amountCents]) => ({ name: getMerchantName(merchantId), amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 3),
  };
}

export function getLastMonthSpending(categoryId?: string): SpendingSummary {
  const { startDate, endDate } = previousCalendarMonth(demoData.metadata.asOfDate);
  return getSpendingSummary(startDate, endDate, categoryId);
}

function monthKey(date: Date): string {
  return format(date, "yyyy-MM");
}

export function getMonthlySpending(months = 12): MonthlySpending[] {
  const end = startOfMonth(asDate(demoData.metadata.asOfDate));
  return Array.from({ length: months }, (_, index) => {
    const monthDate = subMonths(end, months - 1 - index);
    const month = monthKey(monthDate);
    const matching = demoData.transactions.filter((transaction) => transaction.postedOn.startsWith(month));
    return {
      month,
      label: format(monthDate, "MMM"),
      incomeCents: matching
        .filter((transaction) => transaction.categoryId === "income")
        .reduce((sum, transaction) => sum + transaction.amountCents, 0),
      spendingCents: matching
        .filter(isSpending)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0),
      diningCents: matching
        .filter((transaction) => transaction.categoryId === "dining" && isSpending(transaction))
        .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0),
    };
  });
}

export function recurringRuleOccursOn(rule: RecurringRule, dateValue: string): boolean {
  const date = parseISO(`${dateValue}T12:00:00`);
  const day = date.getDate();
  const lastDay = getDaysInMonth(date);
  if (rule.cadence === "semi_monthly") {
    return (rule.daysOfMonth ?? []).some((candidate) => Math.min(candidate, lastDay) === day);
  }
  if (rule.cadence === "yearly") {
    return date.getMonth() + 1 === rule.monthOfYear && Math.min(rule.dayOfMonth ?? 1, lastDay) === day;
  }
  return Math.min(rule.dayOfMonth ?? 1, lastDay) === day;
}

export function getForecast(days = 30): ForecastResult {
  const checking = demoData.accounts.find((account) => account.type === "checking");
  if (!checking) throw new Error("Demo checking account is missing");

  let projected = checking.currentBalanceCents;
  const allEvents: ForecastEvent[] = [];
  const points = dateRange(demoData.metadata.asOfDate, days).map((dateValue, index) => {
    const dayEvents = index === 0
      ? []
      : demoData.recurringRules
          .filter((rule) => rule.active && rule.cashImpact && recurringRuleOccursOn(rule, dateValue))
          .map<ForecastEvent>((rule) => ({
            id: `${rule.id}-${dateValue}`,
            date: dateValue,
            name: rule.name,
            amountCents: rule.amountCents,
            kind: rule.amountCents > 0 ? "income" : "liability",
          }));

    projected += dayEvents.reduce((sum, event) => sum + event.amountCents, 0);
    allEvents.push(...dayEvents);
    return {
      date: dateValue,
      dayLabel: compactDate(dateValue),
      projectedBalanceCents: projected,
      safeToSpendCents: Math.max(0, projected - demoData.persona.reserveFloorCents),
      events: dayEvents,
    };
  });

  const lowest = points.reduce((current, point) =>
    point.projectedBalanceCents < current.projectedBalanceCents ? point : current,
  );

  return {
    asOfDate: demoData.metadata.asOfDate,
    throughDate: points.at(-1)?.date ?? demoData.metadata.asOfDate,
    reserveFloorCents: demoData.persona.reserveFloorCents,
    safeToSpendNowCents: Math.min(...points.map((point) => point.safeToSpendCents)),
    lowestBalanceCents: lowest.projectedBalanceCents,
    lowestBalanceDate: lowest.date,
    points,
    events: allEvents,
  };
}

export function getFinancialSnapshot() {
  const lastMonth = getLastMonthSpending();
  const dining = getLastMonthSpending("dining");
  const forecast = getForecast();
  const monthly = getMonthlySpending();
  const liquidCashCents = demoData.accounts
    .filter((account) => account.type !== "credit")
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const investmentAssetsCents = demoData.investmentAccounts.reduce((sum, account) => sum + account.currentValueCents, 0);
  const netWorthCents = demoData.accounts.reduce((sum, account) => sum + account.currentBalanceCents, 0) + investmentAssetsCents;
  const recurringMonthlyCents = demoData.recurringRules
    .filter((rule) => rule.active && rule.amountCents < 0 && rule.categoryId !== "transfer")
    .reduce((sum, rule) => sum + Math.abs(rule.amountCents), 0);
  const previousThree = monthly.slice(-4, -1);
  const threeMonthAverage = Math.round(
    previousThree.reduce((sum, month) => sum + month.spendingCents, 0) / Math.max(1, previousThree.length),
  );
  const spendingDeltaPercent = threeMonthAverage
    ? Math.round(((lastMonth.amountCents - threeMonthAverage) / threeMonthAverage) * 100)
    : 0;

  return {
    netWorthCents,
    investmentAssetsCents,
    liquidCashCents,
    lastMonthSpendingCents: lastMonth.amountCents,
    lastMonthDiningCents: dining.amountCents,
    recurringMonthlyCents,
    spendingDeltaPercent,
    forecast,
    monthly,
  };
}

const assetClassLabels: Record<AssetClass, string> = {
  us_equity: "U.S. equity",
  international_equity: "International equity",
  bonds: "Bonds",
  cash: "Cash / short Treasury",
};

const assetTargets: Record<AssetClass, number> = {
  us_equity: 6000,
  international_equity: 2000,
  bonds: 1500,
  cash: 500,
};

export function getPortfolioSnapshot() {
  const investedCents = demoData.investmentAccounts.reduce((sum, account) => sum + account.currentValueCents, 0);
  const allocation = (Object.keys(assetClassLabels) as AssetClass[]).map((assetClass) => {
    const valueCents = demoData.holdings
      .filter((holding) => holding.assetClass === assetClass)
      .reduce((sum, holding) => sum + holding.marketValueCents, 0);
    const basisPoints = investedCents ? Math.round((valueCents / investedCents) * 10_000) : 0;
    return {
      assetClass,
      label: assetClassLabels[assetClass],
      valueCents,
      basisPoints,
      targetBasisPoints: assetTargets[assetClass],
      driftBasisPoints: basisPoints - assetTargets[assetClass],
    };
  });
  const start = demoData.portfolioHistory[0]?.valueCents ?? investedCents;
  const contributions = demoData.portfolioHistory.at(-1)?.cumulativeContributionsCents ?? 0;
  const marketMovementCents = investedCents - start - contributions;
  return {
    asOfDate: demoData.metadata.asOfDate,
    investedCents,
    netWorthCents: getFinancialSnapshot().netWorthCents,
    twelveMonthChangeCents: investedCents - start,
    twelveMonthContributionsCents: contributions,
    twelveMonthMarketMovementCents: marketMovementCents,
    allocation,
    accounts: demoData.investmentAccounts.map((account) => ({
      ...account,
      holdings: demoData.holdings.filter((holding) => holding.accountId === account.id),
    })),
    holdings: demoData.holdings,
    history: demoData.portfolioHistory,
    contributions: demoData.investmentContributions,
    taxLimits: demoData.taxLimitReferences,
  };
}

function averageFlexibleSpending() {
  const asOfMonth = demoData.metadata.asOfDate.slice(0, 7);
  const months = [...new Set(demoData.transactions.map((transaction) => transaction.postedOn.slice(0, 7)))]
    .filter((month) => month < asOfMonth)
    .sort()
    .slice(-3);
  const total = months.reduce((sum, month) => sum + demoData.transactions
    .filter((transaction) => transaction.postedOn.startsWith(month) && isSpending(transaction) && !transaction.recurringRuleId)
    .reduce((monthSum, transaction) => monthSum + Math.abs(transaction.amountCents), 0), 0);
  return Math.round(total / Math.max(1, months.length));
}

export function getCashFlowForecast({ days = 90, scenario }: { days?: 30 | 60 | 90; scenario?: PurchaseScenario } = {}): CashFlowForecast {
  const runway = getForecast(days);
  const flexibleCents = averageFlexibleSpending();
  const committedCents = demoData.recurringRules
    .filter((rule) => rule.active && rule.amountCents < 0 && rule.categoryId !== "transfer")
    .reduce((sum, rule) => sum + Math.abs(rule.amountCents), 0);
  const investmentCents = demoData.investmentContributions
    .filter((contribution) => contribution.source === "checking")
    .reduce((sum, contribution) => sum + (contribution.cadence === "semi_monthly" ? contribution.amountCents * 2 : contribution.amountCents), 0);
  const internalTransferCents = 100_000;
  const incomeCents = demoData.persona.monthlyTakeHomeCents;
  const expectedMonthlySurplusCents = incomeCents - committedCents - flexibleCents - investmentCents;
  const monthKeys = [...new Set(runway.points.map((point) => point.date.slice(0, 7)))];
  const monthLabels = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const months = monthKeys.map((month) => {
    const date = new Date(`${month}-01T12:00:00Z`);
    return {
      month,
      label: monthLabels.format(date),
      status: "projected" as const,
      incomeCents,
      committedCents,
      flexibleCents,
      investmentCents,
      internalTransferCents,
      netCents: expectedMonthlySurplusCents,
      events: runway.events.filter((event) => event.date.startsWith(month)),
    };
  });
  const liquidCashCents = demoData.accounts
    .filter((account) => account.type !== "credit")
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const result: CashFlowForecast = {
    days,
    asOfDate: demoData.metadata.asOfDate,
    throughDate: runway.throughDate,
    monthlyTakeHomeCents: incomeCents,
    averageFlexibleSpendingCents: flexibleCents,
    expectedMonthlySurplusCents,
    projectedLiquidCashCents: liquidCashCents + expectedMonthlySurplusCents * months.length,
    safeToSpendNowCents: getForecast(30).safeToSpendNowCents,
    lowestBalanceCents: runway.lowestBalanceCents,
    lowestBalanceDate: runway.lowestBalanceDate,
    months,
    runway,
  };
  if (scenario) result.scenario = evaluatePurchaseAgainstForecast(result, scenario);
  return result;
}

function evaluatePurchaseAgainstForecast(forecast: CashFlowForecast, scenario: PurchaseScenario): PurchaseScenarioResult {
  const monthlySurplusAfterCents = forecast.expectedMonthlySurplusCents - scenario.monthlyCostCents;
  const purchaseDate = new Date(`${scenario.date}T12:00:00Z`);
  const asOfDate = new Date(`${forecast.asOfDate}T12:00:00Z`);
  const throughDate = new Date(`${forecast.throughDate}T12:00:00Z`);
  let paymentCount = 0;
  const purchaseFallsInForecast = !Number.isNaN(purchaseDate.getTime()) && purchaseDate >= asOfDate && purchaseDate <= throughDate;
  if (purchaseFallsInForecast) {
    const paymentDate = new Date(purchaseDate);
    while (paymentDate <= throughDate) {
      paymentCount += 1;
      paymentDate.setUTCMonth(paymentDate.getUTCMonth() + 1);
    }
  }
  const lowestBalanceAfterCents = forecast.lowestBalanceCents - (purchaseFallsInForecast ? scenario.upfrontCostCents : 0) - scenario.monthlyCostCents * paymentCount;
  const safeToSpendAfterCents = lowestBalanceAfterCents - demoData.persona.reserveFloorCents;
  const status = safeToSpendAfterCents < 0
    ? "not_covered"
    : monthlySurplusAfterCents < 0 ? "tight" : "covered";
  const explanation = status === "covered"
    ? "The modeled purchase keeps the checking buffer intact and leaves monthly cash flow positive."
    : status === "tight"
      ? "The checking buffer remains intact, but the recurring payment makes at least one modeled month cash-flow negative."
      : "The modeled purchase would take checking below the protected buffer during the next 90 days.";
  return {
    status,
    scenario,
    safeToSpendBeforeCents: forecast.safeToSpendNowCents,
    safeToSpendAfterCents: Math.max(0, safeToSpendAfterCents),
    monthlySurplusBeforeCents: forecast.expectedMonthlySurplusCents,
    monthlySurplusAfterCents,
    lowestBalanceBeforeCents: forecast.lowestBalanceCents,
    lowestBalanceAfterCents,
    reserveFloorCents: demoData.persona.reserveFloorCents,
    explanation,
  };
}

export function evaluatePurchaseScenario(scenario: PurchaseScenario): PurchaseScenarioResult {
  return evaluatePurchaseAgainstForecast(getCashFlowForecast({ days: 90 }), scenario);
}

export function compareSpendingPeriods(
  categoryId: string | undefined,
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
) {
  const first = getSpendingSummary(firstStart, firstEnd, categoryId);
  const second = getSpendingSummary(secondStart, secondEnd, categoryId);
  const deltaCents = first.amountCents - second.amountCents;
  return {
    first,
    second,
    deltaCents,
    deltaPercent: second.amountCents
      ? Math.round((deltaCents / second.amountCents) * 100)
      : 0,
  };
}

export function getPreviousMonthPair() {
  const asOf = asDate(demoData.metadata.asOfDate);
  const firstMonth = subMonths(asOf, 1);
  const secondMonth = subMonths(asOf, 2);
  const range = (date: Date) => ({
    start: formatISODate(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: formatISODate(new Date(date.getFullYear(), date.getMonth(), getDaysInMonth(date))),
  });
  return { first: range(firstMonth), second: range(secondMonth) };
}

export function getFilteredTransactions(categoryId?: string, max?: number): Array<{
  id: string; date: string; merchant: string; category: string; categoryId: string; account: string; accountId: string;
  amountCents: number; recurring: boolean; type: "expense" | "income" | "transfer";
}>;
export function getFilteredTransactions(filters?: TransactionFilters): Array<{
  id: string; date: string; merchant: string; category: string; categoryId: string; account: string; accountId: string;
  amountCents: number; recurring: boolean; type: "expense" | "income" | "transfer";
}>;
export function getFilteredTransactions(categoryOrFilters?: string | TransactionFilters, max = 100) {
  const filters: TransactionFilters = typeof categoryOrFilters === "string"
    ? { categoryId: categoryOrFilters, limit: max }
    : (categoryOrFilters ?? {});
  const search = filters.search?.trim().toLowerCase() ?? "";
  const transactionType = (transaction: Transaction) => transaction.categoryId === "transfer"
    ? "transfer" as const
    : transaction.categoryId === "income" ? "income" as const : "expense" as const;
  const matching = demoData.transactions
    .filter((transaction) => !filters.startDate || transaction.postedOn >= filters.startDate)
    .filter((transaction) => !filters.endDate || transaction.postedOn <= filters.endDate)
    .filter((transaction) => !filters.accountId || transaction.accountId === filters.accountId)
    .filter((transaction) => !filters.categoryId || transaction.categoryId === filters.categoryId)
    .filter((transaction) => !filters.recurringOnly || Boolean(transaction.recurringRuleId))
    .filter((transaction) => !filters.type || filters.type === "all" || transactionType(transaction) === filters.type)
    .filter((transaction) => !search || `${getMerchantName(transaction.merchantId)} ${getCategoryName(transaction.categoryId)}`.toLowerCase().includes(search));
  const sorted = [...matching].sort((a, b) => {
    if (filters.sort === "oldest") return a.postedOn.localeCompare(b.postedOn);
    if (filters.sort === "amount_high") return Math.abs(b.amountCents) - Math.abs(a.amountCents);
    if (filters.sort === "amount_low") return Math.abs(a.amountCents) - Math.abs(b.amountCents);
    return b.postedOn.localeCompare(a.postedOn);
  });
  return sorted
    .slice(0, filters.limit ?? max)
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.postedOn,
      merchant: getMerchantName(transaction.merchantId),
      category: getCategoryName(transaction.categoryId),
      categoryId: transaction.categoryId,
      account: demoData.accounts.find((account) => account.id === transaction.accountId)?.name ?? transaction.accountId,
      accountId: transaction.accountId,
      amountCents: transaction.amountCents,
      recurring: Boolean(transaction.recurringRuleId),
      type: transactionType(transaction),
    }));
}

export function getRecurringActivity(range: number | { startDate: string; endDate: string } = 90) {
  const dateValues = typeof range === "number"
    ? dateRange(demoData.metadata.asOfDate, range).slice(1)
    : dateRange(range.startDate, Math.max(0, Math.round((new Date(`${range.endDate}T12:00:00Z`).getTime() - new Date(`${range.startDate}T12:00:00Z`).getTime()) / 86_400_000)));
  const rules = demoData.recurringRules
    .filter((rule) => rule.active)
    .map((rule) => ({
      id: rule.id,
      name: rule.name,
      group: rule.categoryId === "subscriptions" ? "Subscription" : rule.categoryId === "utilities" ? "Bill" : rule.categoryId === "transfer" ? "Transfer" : rule.amountCents > 0 ? "Income" : "Commitment",
      amountCents: rule.amountCents,
      cadence: rule.cadence,
      account: demoData.accounts.find((account) => account.id === rule.accountId)?.name ?? rule.accountId,
      nextDate: dateValues.find((dateValue) => recurringRuleOccursOn(rule, dateValue)) ?? null,
      annualCents: Math.abs(rule.amountCents) * (rule.cadence === "semi_monthly" ? 24 : rule.cadence === "yearly" ? 1 : 12),
    }));
  const investments = demoData.investmentContributions.map((contribution) => ({
    id: contribution.id,
    name: contribution.name,
    group: "Investment",
    amountCents: -contribution.amountCents,
    cadence: contribution.cadence,
    account: contribution.source === "checking" ? "Everyday checking" : "Payroll",
    nextDate: dateValues.find((dateValue) => {
      const day = Number(dateValue.slice(8, 10));
      return contribution.cadence === "semi_monthly" ? day === 1 || day === 15 : day === 25;
    }) ?? null,
    annualCents: contribution.annualPlanCents,
  }));
  return [...rules, ...investments];
}
