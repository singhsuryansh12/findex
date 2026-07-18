import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, getDaysInMonth, parseISO, subMonths } from "date-fns";
import type { Account, Category, DemoDataset, Merchant, RecurringRule, Transaction } from "../lib/finance/types";
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

const dataset: DemoDataset = {
  schemaVersion: 1,
  metadata: {
    seed,
    asOfDate,
    generatedAt: `${asOfDate}T16:00:00.000Z`,
    currency: "USD",
    timezone: "America/New_York",
    expectedDiningLastMonthCents,
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
  },
  accounts,
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
