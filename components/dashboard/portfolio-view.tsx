"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, BriefcaseBusiness, ChevronDown, CircleDollarSign, Info, Landmark, Sparkles } from "lucide-react";
import { formatMoney, getPortfolioSnapshot } from "@/lib/finance/engine";
import type { AssetClass, DemoDataset } from "@/lib/finance/types";
import { BrainGuidance } from "@/components/brain/brain-guidance";
import { MetricHint } from "@/components/dashboard/metric-hint";

const allocationColors: Record<AssetClass, string> = {
  us_equity: "#2e765d",
  international_equity: "#759b89",
  bonds: "#c09550",
  cash: "#c9c1af",
};

export function PortfolioView({ dataset, onAskBrain }: { dataset: DemoDataset; onAskBrain: (prompt: string) => void }) {
  const portfolio = useMemo(() => getPortfolioSnapshot(), []);
  const [sort, setSort] = useState<"value" | "name" | "asset">("value");
  const holdings = useMemo(() => [...portfolio.holdings].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "asset") return a.assetClass.localeCompare(b.assetClass) || b.marketValueCents - a.marketValueCents;
    return b.marketValueCents - a.marketValueCents;
  }), [portfolio.holdings, sort]);
  const largestDrift = [...portfolio.allocation].sort((a, b) => Math.abs(b.driftBasisPoints) - Math.abs(a.driftBasisPoints))[0]!;
  const plannedAnnualContributions = portfolio.contributions.reduce((sum, contribution) => sum + contribution.annualPlanCents, 0);
  const history = portfolio.history.map((point) => ({ ...point, gainsCents: point.valueCents - point.cumulativeContributionsCents }));
  const accountName = (id: string) => portfolio.accounts.find((account) => account.id === id)?.name ?? id;
  const assetLabel = (assetClass: AssetClass) => portfolio.allocation.find((item) => item.assetClass === assetClass)?.label ?? assetClass;

  return (
    <div className="fd-view fd-portfolio-view">
      <header className="fd-page-heading">
        <div><span className="fd-eyebrow">Portfolio & net worth</span><h1 className="serif">Your long-term money, in one picture.</h1><p>Four synthetic U.S. investment accounts, organized by purpose, tax treatment, and what they hold.</p></div>
        <button className="fd-ask-button" onClick={() => onAskBrain("How is my portfolio allocation balanced?")}><Sparkles size={15} />Ask the Brain</button>
      </header>

      <BrainGuidance view="portfolio" onSelectChip={(prompt) => onAskBrain(prompt)} />

      <section className="fd-portfolio-hero fd-card">
        <div><span className="fd-eyebrow">Total invested</span><strong className="fd-display-number">{formatMoney(portfolio.investedCents)}</strong><p>Across a 401(k), Roth IRA, taxable brokerage, and HSA.</p><p className="fd-current-contribution">Current recurring plan · <strong>{formatMoney(plannedAnnualContributions)}/year</strong></p></div>
        <div className="fd-portfolio-hero-metrics"><div><span>Complete net worth</span><strong>{formatMoney(portfolio.netWorthCents, 2)}</strong></div><div><span>12-month change</span><strong className="positive">+{formatMoney(portfolio.twelveMonthChangeCents)}</strong></div><div><span>Contributions</span><strong>{formatMoney(portfolio.twelveMonthContributionsCents)}</strong></div><div><span>Market movement</span><strong>{formatMoney(portfolio.twelveMonthMarketMovementCents)}</strong></div></div>
      </section>

      <section className="fd-portfolio-overview">
        <article className="fd-card fd-allocation-card">
          <div className="fd-card-heading"><div><span className="fd-eyebrow">Allocation</span><h2>Close to Jordan’s saved target</h2><p>{largestDrift.label} has the largest drift at {Math.abs(largestDrift.driftBasisPoints / 100).toFixed(1)} percentage points {largestDrift.driftBasisPoints >= 0 ? "above" : "below"} target.</p><MetricHint>Drift is how far today’s mix sits from Jordan’s saved target — small gaps are normal.</MetricHint></div><Info size={16} /></div>
          <div className="fd-allocation-bar" role="img" aria-label="Portfolio allocation: 61.1 percent U.S. equity, 20 percent international equity, 12.4 percent bonds, and 6.6 percent cash">
            {portfolio.allocation.map((item) => <span key={item.assetClass} style={{ width: `${item.basisPoints / 100}%`, background: allocationColors[item.assetClass] }} />)}
          </div>
          <div className="fd-allocation-legend">{portfolio.allocation.map((item) => <div key={item.assetClass}><i style={{ background: allocationColors[item.assetClass] }} /><span><strong>{item.label}</strong><small>{(item.basisPoints / 100).toFixed(1)}% · target {(item.targetBasisPoints / 100).toFixed(0)}%</small></span><em>{formatMoney(item.valueCents)}</em></div>)}</div>
          <p className="fd-note"><Info size={13} />The target is synthetic and is not a recommendation. A suitable allocation depends on time horizon and risk tolerance.</p>
        </article>

        <article className="fd-card fd-history-card">
          <div className="fd-card-heading"><div><span className="fd-eyebrow">12-month path</span><h2>Growth, with contributions separated</h2><p>The ending value reconciles exactly to today’s holdings.</p></div><ArrowUpRight size={17} /></div>
          <div className="fd-portfolio-chart" role="img" aria-label="Twelve month portfolio value chart ending at 145,450 dollars">
            <ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}><defs><linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3d9272" stopOpacity={0.28} /><stop offset="1" stopColor="#3d9272" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="rgba(36,54,44,.08)" /><XAxis dataKey="month" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 10, fill: "#7f8b84" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 100_000)}k`} tick={{ fontSize: 10, fill: "#7f8b84" }} axisLine={false} tickLine={false} width={36} /><Tooltip formatter={(value) => formatMoney(Number(value))} labelFormatter={(value) => String(value)} /><Area type="monotone" dataKey="valueCents" name="Portfolio value" stroke="#2e765d" strokeWidth={2.5} fill="url(#portfolioFill)" /></AreaChart></ResponsiveContainer>
          </div>
          <details className="fd-chart-data"><summary>View chart as a table</summary><table><thead><tr><th scope="col">Month</th><th scope="col">Value</th><th scope="col">Cumulative contributions</th></tr></thead><tbody>{portfolio.history.map((point) => <tr key={point.month}><th scope="row">{point.month}</th><td>{formatMoney(point.valueCents)}</td><td>{formatMoney(point.cumulativeContributionsCents)}</td></tr>)}</tbody></table></details>
        </article>
      </section>

      <section className="fd-account-grid" aria-label="Investment accounts">
        {portfolio.accounts.map((account) => <article className="fd-card" key={account.id}><span className="fd-account-icon">{account.type === "401k" ? <Landmark size={17} /> : account.type === "hsa" ? <CircleDollarSign size={17} /> : <BriefcaseBusiness size={17} />}</span><div><small>{account.institution} · {account.type.replace("_", " ").toUpperCase()}</small><h3>{account.name}</h3><p>{account.description}</p></div><strong>{formatMoney(account.currentValueCents)}</strong><span>{account.holdings.length} holdings</span></article>)}
      </section>

      <section className="fd-card fd-contribution-card">
        <div className="fd-card-heading"><div><span className="fd-eyebrow">Planned contributions</span><h2>Jordan’s plan first, legal limits second</h2><p>Payroll contributions are already reflected in take-home pay; checking contributions affect cash flow.</p></div></div>
        <div className="fd-contribution-list">{portfolio.contributions.map((contribution) => {
          const limit = contribution.accountId === "fidelity-401k" ? dataset.taxLimitReferences.find((item) => item.id === "401k") : contribution.accountId === "vanguard-roth" ? dataset.taxLimitReferences.find((item) => item.id === "ira") : contribution.accountId === "fidelity-hsa" ? dataset.taxLimitReferences.find((item) => item.id === "hsa_self") : null;
          return <article key={contribution.id}><div><strong>{contribution.name}</strong><small>{contribution.source === "checking" ? "From checking" : contribution.source === "employer" ? "Employer funded" : "From payroll"}</small></div><div><span>{formatMoney(contribution.annualPlanCents)} planned</span>{limit && <small>{formatMoney(limit.limitCents)} 2026 limit</small>}</div><i><span style={{ width: `${Math.min(100, contribution.annualPlanCents / Math.max(1, limit?.limitCents ?? contribution.annualPlanCents) * 100)}%` }} /></i></article>;
        })}</div>
      </section>

      <section className="fd-card fd-table-card">
        <div className="fd-card-heading"><div><span className="fd-eyebrow">Holdings</span><h2>What the accounts own</h2></div><label className="fd-sort-label">Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="value">Largest value</option><option value="name">Name</option><option value="asset">Asset class</option></select><ChevronDown size={13} /></label></div>
        <div className="fd-table-scroll"><table className="fd-data-table"><caption>Synthetic investment holdings as of July 19, 2026</caption><thead><tr><th scope="col">Holding</th><th scope="col">Account</th><th scope="col">Asset class</th><th scope="col">Portfolio weight</th><th scope="col">Value</th></tr></thead><tbody>{holdings.map((holding) => <tr key={holding.id}><th scope="row" data-label="Holding"><span className="fd-ticker">{holding.symbol}</span>{holding.name}</th><td data-label="Account">{accountName(holding.accountId)}</td><td data-label="Asset class">{assetLabel(holding.assetClass)}</td><td data-label="Weight">{(holding.marketValueCents / portfolio.investedCents * 100).toFixed(1)}%</td><td data-label="Value">{formatMoney(holding.marketValueCents)}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
