import { describe, expect, it } from "vitest";
import { previousCalendarMonth } from "@/lib/finance/dates";
import {
  demoData,
  getForecast,
  getLastMonthSpending,
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
});
