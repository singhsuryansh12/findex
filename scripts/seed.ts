import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, getDaysInMonth, parseISO, subMonths } from "date-fns";
import type {
  Account,
  Category,
  DemoDataset,
  Holding,
  InvestmentAccount,
  InvestmentContribution,
  Merchant,
  PortfolioHistoryPoint,
  RecurringRule,
  TaxLimitReference,
  Transaction,
} from "../lib/finance/types";
import { assertValidDemoDataset } from "../lib/finance/integrity";

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};

const seed = argValue("--seed", process.env.DEMO_SEED ?? "findex-2026");
const asOfDate = argValue("--as-of", process.env.DEMO_AS_OF ?? "2026-07-19");

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(initial: number) {
  let state = initial;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(hashSeed(seed));
const between = (minimum: number, maximum: number) =>
  Math.round(minimum + random() * (maximum - minimum));
const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]!;

const categories: Category[] = [
  { id: "income", name: "Income", color: "#2e7d61", icon: "ArrowDownLeft" },
  { id: "housing", name: "Housing", color: "#7c6255", icon: "House" },
  { id: "dining", name: "Dining", color: "#d16b4b", icon: "Utensils" },
  { id: "groceries", name: "Groceries", color: "#7b8f4e", icon: "ShoppingBasket" },
  { id: "transport", name: "Transport", color: "#5a77a5", icon: "Car" },
  { id: "shopping", name: "Shopping", color: "#a2698a", icon: "ShoppingBag" },
  { id: "entertainment", name: "Entertainment", color: "#8669aa", icon: "Clapperboard" },
  { id: "utilities", name: "Utilities", color: "#75808c", icon: "Zap" },
  { id: "subscriptions", name: "Subscriptions", color: "#9b7653", icon: "Repeat2" },
  { id: "health", name: "Health", color: "#be6666", icon: "HeartPulse" },
  { id: "travel", name: "Travel", color: "#4e8a92", icon: "Plane" },
  { id: "misc", name: "Other", color: "#85806f", icon: "Shapes" },
  { id: "transfer", name: "Transfer", color: "#a8a49a", icon: "ArrowLeftRight" },
];

const merchants: Merchant[] = [
  { id: "employer", name: "Northstar Labs", categoryId: "income" },
  { id: "landlord", name: "Parkline Properties", categoryId: "housing" },
  { id: "coned", name: "Con Edison", categoryId: "utilities" },
  { id: "fios", name: "Verizon Fios", categoryId: "utilities" },
  { id: "tmobile", name: "T-Mobile", categoryId: "utilities" },
  { id: "geico", name: "GEICO", categoryId: "utilities" },
  { id: "amex-payment", name: "Card autopay", categoryId: "transfer" },
  { id: "savings-transfer", name: "Savings transfer", categoryId: "transfer" },
  { id: "netflix", name: "Netflix", categoryId: "subscriptions" },
  { id: "spotify", name: "Spotify", categoryId: "subscriptions" },
  { id: "icloud", name: "iCloud+", categoryId: "subscriptions" },
  { id: "notion", name: "Notion", categoryId: "subscriptions" },
  { id: "nyt", name: "New York Times", categoryId: "subscriptions" },
  { id: "equinox", name: "Equinox", categoryId: "health" },
  { id: "blue-bottle", name: "Blue Bottle", categoryId: "dining" },
  { id: "sweetgreen", name: "Sweetgreen", categoryId: "dining" },
  { id: "dig", name: "DIG", categoryId: "dining" },
  { id: "thai-diner", name: "Thai Diner", categoryId: "dining" },
  { id: "lilia", name: "Lilia", categoryId: "dining" },
  { id: "trader-joes", name: "Trader Joe's", categoryId: "groceries" },
  { id: "whole-foods", name: "Whole Foods", categoryId: "groceries" },
  { id: "wegmans", name: "Wegmans", categoryId: "groceries" },
  { id: "uber", name: "Uber", categoryId: "transport" },
  { id: "mta", name: "MTA", categoryId: "transport" },
  { id: "citibike", name: "Citi Bike", categoryId: "transport" },
  { id: "amazon", name: "Amazon", categoryId: "shopping" },
  { id: "uniqlo", name: "Uniqlo", categoryId: "shopping" },
  { id: "target", name: "Target", categoryId: "shopping" },
  { id: "amc", name: "AMC Theatres", categoryId: "entertainment" },
  { id: "brooklyn-museum", name: "Brooklyn Museum", categoryId: "entertainment" },
  { id: "cvs", name: "CVS Pharmacy", categoryId: "health" },
  { id: "citymd", name: "CityMD", categoryId: "health" },
  { id: "delta", name: "Delta", categoryId: "travel" },
  { id: "airbnb", name: "Airbnb", categoryId: "travel" },
  { id: "corner-store", name: "Court Street Market", categoryId: "misc" },
  { id: "laundry", name: "Brooklyn Laundry", categoryId: "misc" },
];

const accounts: Account[] = [
  { id: "checking", name: "Everyday checking", institution: "Chase", type: "checking", mask: "1842", openingBalanceCents: 640000, currentBalanceCents: 0 },
  { id: "savings", name: "High-yield savings", institution: "Marcus", type: "savings", mask: "7201", openingBalanceCents: 1420000, currentBalanceCents: 0 },
  { id: "credit", name: "Gold card", institution: "Amex", type: "credit", mask: "9008", openingBalanceCents: -85000, currentBalanceCents: 0 },
];

const investmentAccounts: InvestmentAccount[] = [
  { id: "fidelity-401k", name: "Northstar 401(k)", institution: "Fidelity", type: "401k", taxTreatment: "tax_deferred", currentValueCents: 8_642_000, description: "Employer retirement plan" },
  { id: "vanguard-roth", name: "Roth IRA", institution: "Vanguard", type: "roth_ira", taxTreatment: "roth", currentValueCents: 2_836_000, description: "After-tax retirement account" },
  { id: "schwab-taxable", name: "Individual brokerage", institution: "Schwab", type: "brokerage", taxTreatment: "taxable", currentValueCents: 2_174_000, description: "Flexible long-term investing" },
  { id: "fidelity-hsa", name: "Health savings account", institution: "Fidelity", type: "hsa", taxTreatment: "hsa", currentValueCents: 893_000, description: "Invested health savings" },
];

const holdings: Holding[] = [
  { id: "401k-fxaix", accountId: "fidelity-401k", symbol: "FXAIX", name: "Fidelity 500 Index", assetClass: "us_equity", marketValueCents: 5_185_200 },
  { id: "401k-ftihx", accountId: "fidelity-401k", symbol: "FTIHX", name: "Fidelity Total International Index", assetClass: "international_equity", marketValueCents: 1_728_400 },
  { id: "401k-fxnax", accountId: "fidelity-401k", symbol: "FXNAX", name: "Fidelity U.S. Bond Index", assetClass: "bonds", marketValueCents: 1_296_300 },
  { id: "401k-cash", accountId: "fidelity-401k", symbol: "SPAXX", name: "Government money market", assetClass: "cash", marketValueCents: 432_100 },
  { id: "roth-vti", accountId: "vanguard-roth", symbol: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "us_equity", marketValueCents: 1_701_600 },
  { id: "roth-vxus", accountId: "vanguard-roth", symbol: "VXUS", name: "Vanguard Total International Stock ETF", assetClass: "international_equity", marketValueCents: 567_200 },
  { id: "roth-bnd", accountId: "vanguard-roth", symbol: "BND", name: "Vanguard Total Bond Market ETF", assetClass: "bonds", marketValueCents: 283_600 },
  { id: "roth-qqqm", accountId: "vanguard-roth", symbol: "QQQM", name: "Invesco NASDAQ 100 ETF", assetClass: "us_equity", marketValueCents: 283_600 },
  { id: "taxable-vti", accountId: "schwab-taxable", symbol: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "us_equity", marketValueCents: 1_087_000 },
  { id: "taxable-vxus", accountId: "schwab-taxable", symbol: "VXUS", name: "Vanguard Total International Stock ETF", assetClass: "international_equity", marketValueCents: 434_800 },
  { id: "taxable-bnd", accountId: "schwab-taxable", symbol: "BND", name: "Vanguard Total Bond Market ETF", assetClass: "bonds", marketValueCents: 217_400 },
  { id: "taxable-sgov", accountId: "schwab-taxable", symbol: "SGOV", name: "iShares 0-3 Month Treasury Bond ETF", assetClass: "cash", marketValueCents: 434_800 },
  { id: "hsa-fzrox", accountId: "fidelity-hsa", symbol: "FZROX", name: "Fidelity ZERO Total Market Index", assetClass: "us_equity", marketValueCents: 625_100 },
  { id: "hsa-fzilx", accountId: "fidelity-hsa", symbol: "FZILX", name: "Fidelity ZERO International Index", assetClass: "international_equity", marketValueCents: 178_600 },
  { id: "hsa-cash", accountId: "fidelity-hsa", symbol: "CASH", name: "HSA cash reserve", assetClass: "cash", marketValueCents: 89_300 },
];

const portfolioHistory: PortfolioHistoryPoint[] = [
  ["2025-08", 11_200_000, 0], ["2025-09", 11_376_000, 150_000], ["2025-10", 11_551_000, 300_000],
  ["2025-11", 11_804_000, 450_000], ["2025-12", 11_972_000, 600_000], ["2026-01", 12_225_000, 760_000],
  ["2026-02", 12_371_000, 920_000], ["2026-03", 12_586_000, 1_080_000], ["2026-04", 12_781_000, 1_240_000],
  ["2026-05", 13_205_000, 1_420_000], ["2026-06", 13_852_000, 1_600_000], ["2026-07", 14_545_000, 1_780_000],
].map(([month, valueCents, cumulativeContributionsCents]) => ({ month: String(month), valueCents: Number(valueCents), cumulativeContributionsCents: Number(cumulativeContributionsCents) }));

const investmentContributions: InvestmentContribution[] = [
  { id: "employee-401k", accountId: "fidelity-401k", name: "Employee 401(k)", annualPlanCents: 1_200_000, cadence: "semi_monthly", amountCents: 50_000, source: "payroll" },
  { id: "employer-match", accountId: "fidelity-401k", name: "Employer match", annualPlanCents: 400_000, cadence: "semi_monthly", amountCents: 16_667, source: "employer" },
  { id: "roth-contribution", accountId: "vanguard-roth", name: "Roth IRA auto-invest", annualPlanCents: 360_000, cadence: "monthly", amountCents: 30_000, source: "checking" },
  { id: "hsa-contribution", accountId: "fidelity-hsa", name: "HSA payroll contribution", annualPlanCents: 180_000, cadence: "monthly", amountCents: 15_000, source: "payroll" },
  { id: "taxable-contribution", accountId: "schwab-taxable", name: "Brokerage auto-invest", annualPlanCents: 300_000, cadence: "monthly", amountCents: 25_000, source: "checking" },
];

const taxLimitReferences: TaxLimitReference[] = [
  { id: "401k", year: 2026, limitCents: 2_450_000, label: "401(k) employee deferral limit", sourceUrl: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-401k-and-profit-sharing-plan-contribution-limits" },
  { id: "ira", year: 2026, limitCents: 750_000, label: "Traditional and Roth IRA combined limit", sourceUrl: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits" },
  { id: "hsa_self", year: 2026, limitCents: 440_000, label: "HSA self-only contribution limit", sourceUrl: "https://www.irs.gov/irb/2025-21_IRB" },
];

const recurringRules: RecurringRule[] = [
  { id: "salary", name: "Northstar paycheck", merchantId: "employer", categoryId: "income", accountId: "checking", amountCents: 328000, cadence: "semi_monthly", daysOfMonth: [1, 15], cashImpact: true, active: true },
  { id: "rent", name: "Rent", merchantId: "landlord", categoryId: "housing", accountId: "checking", amountCents: -265000, cadence: "monthly", dayOfMonth: 3, cashImpact: true, active: true },
  { id: "electric", name: "Electric", merchantId: "coned", categoryId: "utilities", accountId: "checking", amountCents: -11800, cadence: "monthly", dayOfMonth: 10, cashImpact: true, active: true },
  { id: "internet", name: "Internet", merchantId: "fios", categoryId: "utilities", accountId: "checking", amountCents: -7900, cadence: "monthly", dayOfMonth: 12, cashImpact: true, active: true },
  { id: "phone", name: "Phone", merchantId: "tmobile", categoryId: "utilities", accountId: "checking", amountCents: -7200, cadence: "monthly", dayOfMonth: 18, cashImpact: true, active: true },
  { id: "insurance", name: "Auto insurance", merchantId: "geico", categoryId: "utilities", accountId: "checking", amountCents: -14600, cadence: "monthly", dayOfMonth: 24, cashImpact: true, active: true },
  { id: "card-autopay", name: "Credit card autopay", merchantId: "amex-payment", categoryId: "transfer", accountId: "checking", amountCents: -200000, cadence: "monthly", dayOfMonth: 20, cashImpact: true, active: true },
  { id: "netflix", name: "Netflix", merchantId: "netflix", categoryId: "subscriptions", accountId: "credit", amountCents: -2299, cadence: "monthly", dayOfMonth: 6, cashImpact: false, active: true },
  { id: "spotify", name: "Spotify", merchantId: "spotify", categoryId: "subscriptions", accountId: "credit", amountCents: -1199, cadence: "monthly", dayOfMonth: 9, cashImpact: false, active: true },
  { id: "icloud", name: "iCloud+", merchantId: "icloud", categoryId: "subscriptions", accountId: "credit", amountCents: -999, cadence: "monthly", dayOfMonth: 14, cashImpact: false, active: true },
  { id: "notion", name: "Notion", merchantId: "notion", categoryId: "subscriptions", accountId: "credit", amountCents: -1000, cadence: "monthly", dayOfMonth: 17, cashImpact: false, active: true },
  { id: "nyt", name: "New York Times", merchantId: "nyt", categoryId: "subscriptions", accountId: "credit", amountCents: -2500, cadence: "monthly", dayOfMonth: 22, cashImpact: false, active: true },
  { id: "gym", name: "Equinox", merchantId: "equinox", categoryId: "health", accountId: "credit", amountCents: -21500, cadence: "monthly", dayOfMonth: 5, cashImpact: false, active: true },
];

const transactions: Transaction[] = [];
let transactionIndex = 0;
const addTransaction = (transaction: Omit<Transaction, "id" | "status">) => {
  transactions.push({ ...transaction, id: `txn-${String(++transactionIndex).padStart(4, "0")}`, status: "posted" });
};

const asOf = parseISO(`${asOfDate}T12:00:00`);
const firstMonth = subMonths(asOf, 11);
const flexiblePlan = [
  { categoryId: "dining", count: 8, minimum: 1200, maximum: 9800, merchants: ["blue-bottle", "sweetgreen", "dig", "thai-diner", "lilia"] },
  { categoryId: "groceries", count: 6, minimum: 3800, maximum: 14500, merchants: ["trader-joes", "whole-foods", "wegmans"] },
  { categoryId: "transport", count: 9, minimum: 290, maximum: 4800, merchants: ["uber", "mta", "citibike"] },
  { categoryId: "shopping", count: 3, minimum: 1900, maximum: 22000, merchants: ["amazon", "uniqlo", "target"] },
  { categoryId: "entertainment", count: 2, minimum: 1800, maximum: 8500, merchants: ["amc", "brooklyn-museum"] },
  { categoryId: "health", count: 1, minimum: 1200, maximum: 11000, merchants: ["cvs", "citymd"] },
  { categoryId: "misc", count: 2, minimum: 700, maximum: 6500, merchants: ["corner-store", "laundry"] },
];

for (let monthOffset = 0; monthOffset < 12; monthOffset += 1) {
  const monthDate = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + monthOffset, 1, 12);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const isCurrentMonth = year === asOf.getFullYear() && month === asOf.getMonth();
  const maximumDay = isCurrentMonth ? asOf.getDate() : getDaysInMonth(monthDate);
  const dateForDay = (day: number) => format(new Date(year, month, Math.min(day, maximumDay), 12), "yyyy-MM-dd");

  for (const day of [1, 15]) {
    if (day <= maximumDay) addTransaction({ accountId: "checking", merchantId: "employer", categoryId: "income", postedOn: dateForDay(day), amountCents: 328000, recurringRuleId: "salary" });
  }

  const fixed = recurringRules.filter((rule) => rule.cadence === "monthly" && rule.id !== "card-autopay");
  for (const rule of fixed) {
    const day = Math.min(rule.dayOfMonth ?? 1, maximumDay);
    if ((rule.dayOfMonth ?? 1) <= maximumDay) {
      addTransaction({ accountId: rule.accountId, merchantId: rule.merchantId, categoryId: rule.categoryId, postedOn: dateForDay(day), amountCents: rule.amountCents, recurringRuleId: rule.id });
    }
  }

  if (16 <= maximumDay) {
    const transferGroupId = `save-${year}-${month + 1}`;
    addTransaction({ accountId: "checking", merchantId: "savings-transfer", categoryId: "transfer", postedOn: dateForDay(16), amountCents: -100000, transferGroupId });
    addTransaction({ accountId: "savings", merchantId: "savings-transfer", categoryId: "transfer", postedOn: dateForDay(16), amountCents: 100000, transferGroupId });
  }
  if (20 <= maximumDay) {
    const transferGroupId = `card-${year}-${month + 1}`;
    addTransaction({ accountId: "checking", merchantId: "amex-payment", categoryId: "transfer", postedOn: dateForDay(20), amountCents: -200000, transferGroupId, recurringRuleId: "card-autopay" });
    addTransaction({ accountId: "credit", merchantId: "amex-payment", categoryId: "transfer", postedOn: dateForDay(20), amountCents: 200000, transferGroupId, recurringRuleId: "card-autopay" });
  }

  for (const plan of flexiblePlan) {
    for (let index = 0; index < plan.count; index += 1) {
      const postedOn = dateForDay(between(1, maximumDay));
      const amount = between(plan.minimum, plan.maximum);
      addTransaction({
        accountId: random() > 0.16 ? "credit" : "checking",
        merchantId: pick(plan.merchants),
        categoryId: plan.categoryId,
        postedOn,
        amountCents: -amount,
      });
    }
  }

  if (monthOffset % 3 === 1 && maximumDay >= 11) {
    addTransaction({ accountId: "credit", merchantId: pick(["delta", "airbnb"]), categoryId: "travel", postedOn: dateForDay(between(7, maximumDay)), amountCents: -between(28000, 78000) });
  }
}

transactions.sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));
for (const account of accounts) {
  account.currentBalanceCents = account.openingBalanceCents + transactions
    .filter((transaction) => transaction.accountId === account.id)
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
}

const previousMonth = format(subMonths(asOf, 1), "yyyy-MM");
const expectedDiningLastMonthCents = transactions
  .filter((transaction) => transaction.postedOn.startsWith(previousMonth) && transaction.categoryId === "dining")
  .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);
const expectedNetWorthCents = accounts.reduce((sum, account) => sum + account.currentBalanceCents, 0)
  + investmentAccounts.reduce((sum, account) => sum + account.currentValueCents, 0);

const dataset: DemoDataset = {
  schemaVersion: 2,
  metadata: {
    seed,
    asOfDate,
    generatedAt: `${asOfDate}T16:00:00.000Z`,
    currency: "USD",
    timezone: "America/New_York",
    expectedDiningLastMonthCents,
    expectedNetWorthCents,
  },
  persona: {
    id: "demo-jordan",
    name: "Jordan Lee",
    firstName: "Jordan",
    initials: "JL",
    role: "Product lead",
    location: "Brooklyn, NY",
    age: 30,
    reserveFloorCents: 150000,
    grossAnnualIncomeCents: 10_000_000,
    monthlyTakeHomeCents: 656_000,
  },
  accounts,
  investmentAccounts,
  holdings,
  portfolioHistory,
  investmentContributions,
  taxLimitReferences,
  categories,
  merchants,
  recurringRules,
  transactions,
};

assertValidDemoDataset(dataset);

const currentFile = fileURLToPath(import.meta.url);
const outputPath = path.resolve(path.dirname(currentFile), "../data/demo-data.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(`Seeded ${transactions.length} transactions to ${outputPath}`);
console.log(`Expected dining last month: $${(expectedDiningLastMonthCents / 100).toFixed(2)}`);
