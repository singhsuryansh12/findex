import { format, getDaysInMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import demoDataJson from "@/data/demo-data.json";
import { asDate, compactDate, dateRange, formatISODate, previousCalendarMonth } from "./dates";
import type {
  DemoDataset,
  ForecastEvent,
  ForecastResult,
  MonthlySpending,
  RecurringRule,
  SpendingSummary,
  Transaction,
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
  const netWorthCents = demoData.accounts.reduce((sum, account) => sum + account.currentBalanceCents, 0);
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
    liquidCashCents,
    lastMonthSpendingCents: lastMonth.amountCents,
    lastMonthDiningCents: dining.amountCents,
    recurringMonthlyCents,
    spendingDeltaPercent,
    forecast,
    monthly,
  };
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

export function getFilteredTransactions(categoryId?: string, max = 100) {
  return demoData.transactions
    .filter((transaction) => !categoryId || transaction.categoryId === categoryId)
    .sort((a, b) => b.postedOn.localeCompare(a.postedOn))
    .slice(0, max)
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.postedOn,
      merchant: getMerchantName(transaction.merchantId),
      category: getCategoryName(transaction.categoryId),
      amountCents: transaction.amountCents,
    }));
}
