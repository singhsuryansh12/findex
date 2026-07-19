import { addDays, format, parseISO } from "date-fns";
import type { DemoDataset } from "./types";

export type IntegrityReport = { valid: boolean; errors: string[] };

export function validateDemoDataset(dataset: DemoDataset): IntegrityReport {
  const errors: string[] = [];
  const accountIds = new Set(dataset.accounts.map((item) => item.id));
  const merchantIds = new Set(dataset.merchants.map((item) => item.id));
  const categoryIds = new Set(dataset.categories.map((item) => item.id));
  const recurringIds = new Set(dataset.recurringRules.map((item) => item.id));
  const investmentAccountIds = new Set(dataset.investmentAccounts.map((item) => item.id));
  const transactionIds = new Set<string>();
  const monthCoverage = new Set<string>();
  const transferGroups = new Map<string, number[]>();

  for (const transaction of dataset.transactions) {
    if (transactionIds.has(transaction.id)) errors.push(`Duplicate transaction ID: ${transaction.id}`);
    transactionIds.add(transaction.id);
    monthCoverage.add(transaction.postedOn.slice(0, 7));
    if (!accountIds.has(transaction.accountId)) errors.push(`${transaction.id} references a missing account.`);
    if (!merchantIds.has(transaction.merchantId)) errors.push(`${transaction.id} references a missing merchant.`);
    if (!categoryIds.has(transaction.categoryId)) errors.push(`${transaction.id} references a missing category.`);
    if (transaction.recurringRuleId && !recurringIds.has(transaction.recurringRuleId)) errors.push(`${transaction.id} references a missing recurrence.`);
    if (!Number.isSafeInteger(transaction.amountCents)) errors.push(`${transaction.id} does not use integer cents.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.postedOn)) errors.push(`${transaction.id} does not use an ISO date-only value.`);
    if (transaction.transferGroupId) {
      transferGroups.set(transaction.transferGroupId, [...(transferGroups.get(transaction.transferGroupId) ?? []), transaction.amountCents]);
    }
  }

  for (const account of dataset.accounts) {
    const derived = account.openingBalanceCents + dataset.transactions
      .filter((transaction) => transaction.accountId === account.id)
      .reduce((sum, transaction) => sum + transaction.amountCents, 0);
    if (derived !== account.currentBalanceCents) errors.push(`${account.id} does not reconcile to its ledger.`);
  }
  for (const account of dataset.investmentAccounts) {
    const holdingsTotal = dataset.holdings
      .filter((holding) => holding.accountId === account.id)
      .reduce((sum, holding) => sum + holding.marketValueCents, 0);
    if (holdingsTotal !== account.currentValueCents) errors.push(`${account.id} does not reconcile to its holdings.`);
  }
  for (const holding of dataset.holdings) {
    if (!investmentAccountIds.has(holding.accountId)) errors.push(`${holding.id} references a missing investment account.`);
    if (!Number.isSafeInteger(holding.marketValueCents) || holding.marketValueCents < 0) errors.push(`${holding.id} has an invalid market value.`);
  }
  for (const contribution of dataset.investmentContributions) {
    if (!investmentAccountIds.has(contribution.accountId)) errors.push(`${contribution.id} references a missing investment account.`);
    if (contribution.source !== "checking" && contribution.amountCents > contribution.annualPlanCents) errors.push(`${contribution.id} has an invalid payroll contribution.`);
  }
  const investmentTotal = dataset.investmentAccounts.reduce((sum, account) => sum + account.currentValueCents, 0);
  const allocationTotal = dataset.holdings.reduce((sum, holding) => sum + holding.marketValueCents, 0);
  if (investmentTotal !== allocationTotal) errors.push("Portfolio allocation does not total the investment accounts.");
  const allocationBasisPoints = [...new Set(dataset.holdings.map((holding) => holding.assetClass))]
    .reduce((sum, assetClass) => {
      const assetTotal = dataset.holdings.filter((holding) => holding.assetClass === assetClass).reduce((value, holding) => value + holding.marketValueCents, 0);
      return sum + Math.round(assetTotal / Math.max(1, investmentTotal) * 10_000);
    }, 0);
  if (allocationBasisPoints !== 10_000) errors.push("Portfolio allocation basis points do not total 10,000.");
  if (dataset.portfolioHistory.at(-1)?.valueCents !== investmentTotal) errors.push("Portfolio history does not end at the current investment value.");
  if (dataset.taxLimitReferences.some((reference) => reference.year !== 2026 || reference.limitCents <= 0)) errors.push("Tax limit references are invalid.");
  const combinedNetWorth = dataset.accounts.reduce((sum, account) => sum + account.currentBalanceCents, 0) + investmentTotal;
  if (combinedNetWorth !== dataset.metadata.expectedNetWorthCents) errors.push("Cash, investments, and liabilities do not reconcile to expected net worth.");
  const contributionIds = new Set<string>();
  for (const contribution of dataset.investmentContributions) {
    if (contributionIds.has(contribution.id)) errors.push(`Duplicate investment contribution: ${contribution.id}`);
    contributionIds.add(contribution.id);
    const duplicatedRule = dataset.recurringRules.some((rule) => rule.kind === "investment" && (rule.id === contribution.id || (rule.destinationAccountId === contribution.accountId && Math.abs(rule.amountCents) === contribution.amountCents)));
    if (duplicatedRule) errors.push(`${contribution.id} is double-counted as a recurring rule.`);
  }
  for (const [group, amounts] of transferGroups) {
    if (amounts.length !== 2 || amounts.reduce((sum, amount) => sum + amount, 0) !== 0) errors.push(`Transfer ${group} is not a balanced pair.`);
  }
  if (dataset.transactions.some((transaction) => transaction.transferGroupId && transaction.categoryId !== "transfer")) errors.push("An investment or account transfer is classified as spending.");
  if (monthCoverage.size < 12) errors.push("The ledger does not cover 12 distinct months.");
  if (dataset.transactions.length < 450) errors.push("The ledger has fewer than 450 posted transactions.");

  const asOf = parseISO(`${dataset.metadata.asOfDate}T12:00:00`);
  const prior = format(new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1), "yyyy-MM");
  const dining = dataset.transactions.filter((transaction) => transaction.postedOn.startsWith(prior) && transaction.categoryId === "dining");
  if (!dining.length) errors.push("Previous calendar month has no dining activity.");
  if (dining.reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0) !== dataset.metadata.expectedDiningLastMonthCents) errors.push("Expected dining amount does not match the ledger.");

  const through = format(addDays(asOf, 30), "yyyy-MM-dd");
  const hasFutureCashLiability = dataset.recurringRules.some((rule) => rule.active && rule.cashImpact && rule.amountCents < 0);
  if (!hasFutureCashLiability || through <= dataset.metadata.asOfDate) errors.push("No future cash liabilities are available for forecasting.");
  if (!monthCoverage.has(dataset.metadata.asOfDate.slice(0, 7))) errors.push("As-of month is missing from the ledger.");

  return { valid: errors.length === 0, errors };
}

export function assertValidDemoDataset(dataset: DemoDataset): void {
  const report = validateDemoDataset(dataset);
  if (!report.valid) throw new Error(`Invalid demo dataset:\n${report.errors.join("\n")}`);
}
