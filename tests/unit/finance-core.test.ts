import { describe, expect, it } from "vitest";
import { previousCalendarMonth } from "@/lib/finance/dates";
import {
  demoData,
  evaluatePurchaseScenario,
  getCashFlowForecast,
  getFilteredTransactions,
  getFinancialSnapshot,
  getForecast,
  getLastMonthSpending,
  getPortfolioSnapshot,
  getRecurringActivity,
  getSpendingSummary,
  isSpending,
  recurringRuleOccursOn,
} from "@/lib/finance/engine";
import { validateDemoDataset } from "@/lib/finance/integrity";
import type { RecurringRule } from "@/lib/finance/types";

describe("deterministic finance core", () => {
  it("keeps the frozen fixture deterministic and referentially sound", () => {
    const report = validateDemoDataset(demoData);
    expect(report.errors).toEqual([]);
    expect(demoData.schemaVersion).toBe(2);
    expect(demoData.metadata.seed).toBe("findex-2026");
    expect(demoData.metadata.asOfDate).toBe("2026-07-19");
    expect(demoData.transactions).toHaveLength(576);
    expect(demoData.transactions[0]?.id).toBe("txn-0001");
  });

  it("stores every financial amount as integer cents and reconciles accounts", () => {
    for (const transaction of demoData.transactions) expect(Number.isSafeInteger(transaction.amountCents)).toBe(true);
    for (const account of demoData.accounts) {
      const derived = account.openingBalanceCents + demoData.transactions
        .filter((transaction) => transaction.accountId === account.id)
        .reduce((sum, transaction) => sum + transaction.amountCents, 0);
      expect(account.currentBalanceCents).toBe(derived);
    }
  });

  it("resolves last month as the previous calendar month, including leap years", () => {
    expect(previousCalendarMonth("2026-07-19")).toEqual({ startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(previousCalendarMonth("2024-03-01")).toEqual({ startDate: "2024-02-01", endDate: "2024-02-29" });
  });

  it("freezes the required dining answer to the exact ledger-derived result", () => {
    const dining = getLastMonthSpending("dining");
    expect(dining.amountCents).toBe(36_621);
    expect(dining.count).toBe(8);
    expect(dining.startDate).toBe("2026-06-01");
    expect(dining.endDate).toBe("2026-06-30");
    expect(dining.amountCents).toBe(demoData.metadata.expectedDiningLastMonthCents);
  });

  it("excludes linked transfers and card payments from spending", () => {
    const summary = getSpendingSummary("2026-06-01", "2026-06-30");
    const manual = demoData.transactions
      .filter((transaction) => transaction.postedOn.startsWith("2026-06") && isSpending(transaction))
      .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);
    const transfers = demoData.transactions.filter((transaction) => transaction.postedOn.startsWith("2026-06") && transaction.categoryId === "transfer");
    expect(transfers.length).toBeGreaterThan(0);
    expect(summary.amountCents).toBe(manual);
  });

  it("reconciles every investment account, holding, allocation, and net-worth total", () => {
    const portfolio = getPortfolioSnapshot();
    expect(portfolio.investedCents).toBe(14_545_000);
    expect(portfolio.holdings.reduce((sum, holding) => sum + holding.marketValueCents, 0)).toBe(portfolio.investedCents);
    for (const account of portfolio.accounts) {
      expect(account.holdings.reduce((sum, holding) => sum + holding.marketValueCents, 0)).toBe(account.currentValueCents);
    }
    expect(portfolio.allocation.reduce((sum, item) => sum + item.basisPoints, 0)).toBe(10_000);
    expect(portfolio.allocation.map(({ valueCents }) => valueCents)).toEqual([8_882_500, 2_909_000, 1_797_300, 956_200]);
    expect(portfolio.history.at(-1)?.valueCents).toBe(portfolio.investedCents);
    expect(portfolio.netWorthCents).toBe(18_055_772);
    expect(demoData.metadata.expectedNetWorthCents).toBe(18_055_772);
    expect(getFinancialSnapshot().netWorthCents).toBe(18_055_772);
  });

  it("keeps dated 2026 legal limits separate from Jordan's contribution plan", () => {
    const portfolio = getPortfolioSnapshot();
    expect(Object.fromEntries(portfolio.taxLimits.map((limit) => [limit.id, limit.limitCents]))).toEqual({
      "401k": 2_450_000,
      ira: 750_000,
      hsa_self: 440_000,
    });
    expect(portfolio.contributions.reduce((sum, contribution) => sum + contribution.annualPlanCents, 0)).toBe(2_440_000);
    expect(portfolio.taxLimits.every((limit) => limit.year === 2026 && limit.sourceUrl.startsWith("https://www.irs.gov/"))).toBe(true);
  });

  it("filters activity deterministically from one result set", () => {
    const dining = getFilteredTransactions({ startDate: "2026-06-01", endDate: "2026-06-30", categoryId: "dining" });
    expect(dining).toHaveLength(8);
    expect(dining.reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0)).toBe(36_621);
    expect(getFilteredTransactions({ search: "sweetgreen", type: "expense" }).every((transaction) => transaction.merchant === "Sweetgreen")).toBe(true);
    expect(getRecurringActivity().filter((item) => item.group === "Investment").every((item) => item.nextDate! > demoData.metadata.asOfDate)).toBe(true);
  });
});

describe("forecast recurrence and protection", () => {
  const monthEndRule: RecurringRule = {
    id: "month-end", name: "Month end", merchantId: "coned", categoryId: "utilities",
    accountId: "checking", amountCents: -1000, cadence: "monthly", dayOfMonth: 31,
    cashImpact: true, active: true,
  };

  it("clamps month-end recurrence across regular and leap-year Februaries", () => {
    expect(recurringRuleOccursOn(monthEndRule, "2024-02-29")).toBe(true);
    expect(recurringRuleOccursOn(monthEndRule, "2023-02-28")).toBe(true);
    expect(recurringRuleOccursOn(monthEndRule, "2024-02-28")).toBe(false);
  });

  it("changes each daily balance by exactly that day’s known cash events", () => {
    const forecast = getForecast();
    for (let index = 1; index < forecast.points.length; index += 1) {
      const prior = forecast.points[index - 1]!;
      const point = forecast.points[index]!;
      const expectedDelta = point.events.reduce((sum, event) => sum + event.amountCents, 0);
      expect(point.projectedBalanceCents - prior.projectedBalanceCents).toBe(expectedDelta);
    }
  });

  it("defines headline safe-to-spend from the lowest 30-day balance and reserve", () => {
    const forecast = getForecast();
    const lowest = Math.min(...forecast.points.map((point) => point.projectedBalanceCents));
    expect(forecast.lowestBalanceCents).toBe(lowest);
    expect(forecast.safeToSpendNowCents).toBe(Math.max(0, lowest - forecast.reserveFloorCents));
  });

  it("does not deduct payroll investing or internal transfers from monthly net cash flow", () => {
    const forecast = getCashFlowForecast({ days: 90 });
    const month = forecast.months[0]!;
    expect(forecast.monthlyTakeHomeCents).toBe(656_000);
    expect(month.investmentCents).toBe(55_000);
    expect(month.internalTransferCents).toBe(100_000);
    expect(month.netCents).toBe(month.incomeCents - month.committedCents - month.flexibleCents - month.investmentCents);
    expect(month.netCents).not.toBe(month.incomeCents - month.committedCents - month.flexibleCents - month.investmentCents - month.internalTransferCents);
  });

  it("maps cash-flow horizons to one modeled month per 30 days", () => {
    const thirty = getCashFlowForecast({ days: 30 });
    const sixty = getCashFlowForecast({ days: 60 });
    const ninety = getCashFlowForecast({ days: 90 });

    // Daily runway still spans the selected horizon (as-of Jul 19 → +N days).
    expect(thirty.throughDate).toBe("2026-08-18");
    expect(sixty.throughDate).toBe("2026-09-17");
    expect(ninety.throughDate).toBe("2026-10-17");

    // Monthly chart buckets are whole cycles, not every calendar month touched.
    expect(thirty.months.map((month) => month.month)).toEqual(["2026-07"]);
    expect(sixty.months.map((month) => month.month)).toEqual(["2026-07", "2026-08"]);
    expect(ninety.months.map((month) => month.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("classifies the fixed car scenario from the base forecast deterministically", () => {
    const input = { date: "2026-08-15", upfrontCostCents: 1_500_000, monthlyCostCents: 65_000 };
    const first = evaluatePurchaseScenario(input);
    expect(evaluatePurchaseScenario(input)).toEqual(first);
    expect(first.status).toBe("not_covered");
    expect(first.safeToSpendBeforeCents).toBe(730_916);
    expect(first.safeToSpendAfterCents).toBe(0);
    expect(first.lowestBalanceAfterCents).toBeLessThan(first.reserveFloorCents);
    expect(first.lowestBalanceAfterCents).toBeLessThan(first.lowestBalanceBeforeCents);
  });
});
