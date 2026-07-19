"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ListFilter, RefreshCw, Search, Sparkles } from "lucide-react";
import type { DemoDataset, TransactionFilters } from "@/lib/finance/types";
import { formatMoney, getFilteredTransactions, getRecurringActivity } from "@/lib/finance/engine";

type ActivityView = "activity" | "recurring";
type DatePreset = "30_days" | "last_month" | "90_days" | "custom";

function offsetDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function SpendingView({ dataset, onAskBrain }: { dataset: DemoDataset; onAskBrain: (prompt: string) => void }) {
  const [view, setView] = useState<ActivityView>("activity");
  const [datePreset, setDatePreset] = useState<DatePreset>("30_days");
  const [recurringLayout, setRecurringLayout] = useState<"list" | "calendar">("list");
  const [visible, setVisible] = useState(25);
  const [filters, setFilters] = useState<TransactionFilters>({
    startDate: "2026-06-20",
    endDate: dataset.metadata.asOfDate,
    type: "all",
    sort: "newest",
  });
  const update = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) => {
    setVisible(25);
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  };
  const reset = () => {
    setVisible(25);
    setDatePreset("30_days");
    setFilters({ startDate: "2026-06-20", endDate: dataset.metadata.asOfDate, type: "all", sort: "newest" });
  };
  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = preset === "last_month"
      ? { startDate: "2026-06-01", endDate: "2026-06-30" }
      : { startDate: offsetDate(dataset.metadata.asOfDate, preset === "90_days" ? -89 : -29), endDate: dataset.metadata.asOfDate };
    setVisible(25);
    setFilters((current) => ({ ...current, ...range }));
  };
  const matching = useMemo(() => getFilteredTransactions({ ...filters, limit: 1_000 }), [filters]);
  const expenses = matching.filter((transaction) => transaction.type === "expense");
  const income = matching.filter((transaction) => transaction.type === "income");
  const spendingCents = expenses.reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);
  const incomeCents = income.reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const netCents = incomeCents - spendingCents;
  const categories = (() => {
    const totals = new Map<string, { id: string; label: string; value: number }>();
    for (const transaction of expenses) {
      const current = totals.get(transaction.categoryId) ?? { id: transaction.categoryId, label: transaction.category, value: 0 };
      current.value += Math.abs(transaction.amountCents);
      totals.set(transaction.categoryId, current);
    }
    return [...totals.values()].sort((a, b) => b.value - a.value).slice(0, 6);
  })();
  const maximumCategory = Math.max(1, ...categories.map((category) => category.value));
  const recurring = useMemo(() => getRecurringActivity(), []);
  const recurringSorted = useMemo(() => [...recurring].sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999")), [recurring]);
  const recurringByDate = useMemo(() => {
    const groups = new Map<string, typeof recurring>();
    for (const item of recurringSorted.filter((entry) => entry.nextDate && entry.nextDate <= offsetDate(dataset.metadata.asOfDate, 30))) {
      const entries = groups.get(item.nextDate!) ?? [];
      entries.push(item);
      groups.set(item.nextDate!, entries);
    }
    return [...groups.entries()];
  }, [dataset.metadata.asOfDate, recurringSorted]);
  const subscriptionTotal = recurring.filter((item) => item.group === "Subscription").reduce((sum, item) => sum + Math.abs(item.amountCents), 0);

  return (
    <div className="fd-view fd-spending-view">
      <header className="fd-page-heading">
        <div><span className="fd-eyebrow">Spending & activity</span><h1 className="serif">See where your money went.</h1><p>Search every demo transaction, then zoom out to bills, subscriptions, and recurring investments.</p></div>
        <button className="fd-ask-button" onClick={() => onAskBrain("Where did my money go last month?")}><Sparkles size={15} />Ask the Brain</button>
      </header>

      <div className="fd-segmented" role="tablist" aria-label="Spending view">
        <button role="tab" aria-selected={view === "activity"} className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}>Activity</button>
        <button role="tab" aria-selected={view === "recurring"} className={view === "recurring" ? "active" : ""} onClick={() => setView("recurring")}>Recurring</button>
      </div>

      {view === "activity" ? (
        <>
          <section className="fd-metric-row" aria-label="Filtered transaction summary">
            <article><span>Spending</span><strong>{formatMoney(spendingCents, 2)}</strong><small>{expenses.length} expenses</small></article>
            <article><span>Income</span><strong>{formatMoney(incomeCents, 2)}</strong><small>{income.length} deposits</small></article>
            <article className={netCents >= 0 ? "positive" : "warning"}><span>Net cash flow</span><strong>{formatMoney(netCents, 2)}</strong><small>Income minus spending</small></article>
            <article><span>Results</span><strong>{matching.length}</strong><small>Including transfers</small></article>
          </section>

          <section className="fd-card fd-filter-card" aria-label="Transaction filters">
            <label className="fd-search-field"><Search size={15} /><input value={filters.search ?? ""} onChange={(event) => update("search", event.target.value)} placeholder="Search merchant or category" aria-label="Search transactions" /></label>
            <label><span>Period</span><select aria-label="Date preset" value={datePreset} onChange={(event) => applyDatePreset(event.target.value as DatePreset)}><option value="30_days">Last 30 days</option><option value="last_month">Last calendar month</option><option value="90_days">Last 90 days</option><option value="custom">Custom range</option></select><ChevronDown size={13} /></label>
            <label><span>From</span><input type="date" value={filters.startDate ?? ""} onChange={(event) => { setDatePreset("custom"); update("startDate", event.target.value); }} /></label>
            <label><span>To</span><input type="date" value={filters.endDate ?? ""} max={dataset.metadata.asOfDate} onChange={(event) => { setDatePreset("custom"); update("endDate", event.target.value); }} /></label>
            <label><span>Account</span><select value={filters.accountId ?? ""} onChange={(event) => update("accountId", event.target.value)}><option value="">All accounts</option>{dataset.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={13} /></label>
            <label><span>Category</span><select value={filters.categoryId ?? ""} onChange={(event) => update("categoryId", event.target.value)}><option value="">All categories</option>{dataset.categories.filter((category) => category.id !== "transfer").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><ChevronDown size={13} /></label>
            <label><span>Type</span><select value={filters.type ?? "all"} onChange={(event) => update("type", event.target.value as TransactionFilters["type"])}><option value="all">All activity</option><option value="expense">Expenses</option><option value="income">Income</option><option value="transfer">Transfers</option></select><ChevronDown size={13} /></label>
            <label><span>Sort</span><select value={filters.sort ?? "newest"} onChange={(event) => update("sort", event.target.value as TransactionFilters["sort"])}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_high">Largest amount</option><option value="amount_low">Smallest amount</option></select><ChevronDown size={13} /></label>
            <button type="button" className="fd-check" aria-pressed={Boolean(filters.recurringOnly)} onClick={() => update("recurringOnly", !filters.recurringOnly)}><span className="fd-check-box" aria-hidden="true">{filters.recurringOnly ? "✓" : ""}</span><span>Recurring only</span></button>
            <button className="fd-reset-filter" onClick={reset}><RefreshCw size={13} />Reset</button>
          </section>

          <section className="fd-spending-grid">
            <article className="fd-card fd-category-card">
              <div className="fd-card-heading"><div><span className="fd-eyebrow">One useful pattern</span><h2>Spending by category</h2><p>Select a category to filter the activity table.</p></div><ListFilter size={16} /></div>
              <div className="fd-category-bars">
                {categories.map((category) => <button key={category.id} onClick={() => update("categoryId", filters.categoryId === category.id ? "" : category.id)} className={filters.categoryId === category.id ? "active" : ""}><span><b>{category.label}</b><em>{formatMoney(category.value)}</em></span><i><span style={{ width: `${(category.value / maximumCategory) * 100}%` }} /></i></button>)}
              </div>
            </article>
            <article className="fd-card fd-spending-insight"><span className="fd-insight-icon"><Sparkles size={17} /></span><div><span className="fd-eyebrow">Plain-language read</span><h2>{netCents >= 0 ? "You kept more than you spent." : "Spending was ahead of income."}</h2><p>{netCents >= 0 ? `${formatMoney(netCents)} remained after recorded spending in this period.` : `${formatMoney(Math.abs(netCents))} more went out than came in during this period.`}</p><button onClick={() => onAskBrain(`Explain my spending from ${filters.startDate} to ${filters.endDate}`)}>Ask why</button></div></article>
          </section>

          <section className="fd-card fd-table-card">
            <div className="fd-card-heading"><div><span className="fd-eyebrow">All activity</span><h2>{matching.length} matching transactions</h2></div><span className="fd-demo-chip">Demo data · Jul 19, 2026</span></div>
            <div className="fd-table-scroll">
              <table className="fd-data-table">
                <caption>Transactions matching the selected filters</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col">Account</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead>
                <tbody>{matching.slice(0, visible).map((transaction) => <tr key={transaction.id}><td data-label="Date">{new Date(`${transaction.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td><th scope="row" data-label="Merchant">{transaction.merchant}</th><td data-label="Category"><button className="fd-category-pill" onClick={() => update("categoryId", transaction.categoryId)}>{transaction.category}</button></td><td data-label="Account">{transaction.account}</td><td data-label="Status">{transaction.recurring ? "Recurring" : "Posted"}</td><td data-label="Amount" className={transaction.amountCents > 0 ? "positive" : ""}>{transaction.amountCents > 0 ? "+" : "−"}{formatMoney(Math.abs(transaction.amountCents), 2)}</td></tr>)}</tbody>
              </table>
            </div>
            {visible < matching.length && <button className="fd-load-more" onClick={() => setVisible((current) => current + 25)}>Load 25 more</button>}
          </section>
        </>
      ) : (
        <>
          <section className="fd-metric-row" aria-label="Recurring summary">
            <article><span>Subscriptions</span><strong>{formatMoney(subscriptionTotal, 2)}</strong><small>{formatMoney(subscriptionTotal * 12, 2)} per year</small></article>
            <article><span>Recurring items</span><strong>{recurring.length}</strong><small>Bills, income, and investments</small></article>
            <article><span>Next paycheck</span><strong>Aug 1</strong><small>+{formatMoney(328_000, 2)}</small></article>
            <article><span>Auto-investing</span><strong>{formatMoney(55_000)}</strong><small>From checking each month</small></article>
          </section>
          <section className="fd-card fd-recurring-card">
            <div className="fd-card-heading"><div><span className="fd-eyebrow">What is coming up</span><h2>Bills, subscriptions, and investing</h2><p>Payroll contributions are shown separately so they are never deducted from take-home twice.</p></div><div className="fd-recurring-layout" aria-label="Recurring layout"><button className={recurringLayout === "list" ? "active" : ""} onClick={() => setRecurringLayout("list")}>List</button><button className={recurringLayout === "calendar" ? "active" : ""} onClick={() => setRecurringLayout("calendar")}><CalendarDays size={12} />Calendar</button></div></div>
            {recurringLayout === "list" ? <div className="fd-recurring-list">{recurringSorted.map((item) => <article key={item.id}><span className={`fd-recurring-mark ${item.group.toLowerCase()}`} /><div><strong>{item.name}</strong><small>{item.group} · {item.account}</small></div><div><strong>{item.amountCents > 0 ? "+" : "−"}{formatMoney(Math.abs(item.amountCents), 2)}</strong><small>{item.nextDate ? new Date(`${item.nextDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : item.cadence}</small></div></article>)}</div> : <div className="fd-recurring-calendar" aria-label="Next 30 days recurring calendar">{recurringByDate.map(([date, items]) => <article key={date}><time dateTime={date}><strong>{new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</strong><span>{new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></time><div>{items.map((item) => <span key={item.id}><b>{item.name}</b><em>{item.amountCents > 0 ? "+" : "−"}{formatMoney(Math.abs(item.amountCents), 2)}</em><small>{item.group} · {item.account}</small></span>)}</div></article>)}</div>}
          </section>
        </>
      )}
    </div>
  );
}
