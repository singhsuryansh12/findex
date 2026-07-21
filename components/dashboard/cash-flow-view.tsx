"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, ChevronRight, CircleDollarSign, Info, Sparkles, WalletCards } from "lucide-react";
import type { DemoDataset } from "@/lib/finance/types";
import { formatMoney, getCashFlowForecast } from "@/lib/finance/engine";
import { BrainGuidance } from "@/components/brain/brain-guidance";
import { MetricHint } from "@/components/dashboard/metric-hint";
import { ForecastChart } from "./forecast-chart";

export function CashFlowView({ dataset, onAskBrain }: { dataset: DemoDataset; onAskBrain: (prompt: string) => void }) {
  const [days, setDays] = useState<30 | 60 | 90>(90);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const forecast = useMemo(() => getCashFlowForecast({ days }), [days]);
  const selected = forecast.months.find((month) => month.month === selectedMonth) ?? forecast.months[0];
  const chartData = forecast.months.map((month) => ({
    ...month,
    income: month.incomeCents,
    outflow: -(month.committedCents + month.flexibleCents),
    investing: -month.investmentCents,
  }));
  const liquidCashCents = dataset.accounts.filter((account) => account.type !== "credit").reduce((sum, account) => sum + account.currentBalanceCents, 0);

  return (
    <div className="fd-view fd-cashflow-view">
      <header className="fd-page-heading">
        <div><span className="fd-eyebrow">Income & cash flow</span><h1 className="serif">Know what your money can handle next.</h1><p>Take-home pay, upcoming commitments, typical spending, and investing—without counting the same dollar twice.</p></div>
        <button className="fd-ask-button" onClick={() => onAskBrain("What is safe to spend and how does my cash flow look?")}><Sparkles size={15} />Ask the Brain</button>
      </header>

      <BrainGuidance view="cash-flow" onSelectChip={(prompt) => onAskBrain(prompt)} />

      <section className="fd-metric-row fd-cash-metrics" aria-label="Cash flow summary">
        <article className="featured">
          <span className="fd-metric-label">Safe to spend now</span>
          <strong className="fd-metric-value">{formatMoney(forecast.safeToSpendNowCents)}</strong>
          <div className="fd-metric-meta">
            <small>Protects the {formatMoney(dataset.persona.reserveFloorCents)} checking buffer</small>
            <MetricHint>Cash you can use now while keeping the checking safety buffer intact.</MetricHint>
          </div>
        </article>
        <article>
          <span className="fd-metric-label">Take-home income</span>
          <strong className="fd-metric-value">{formatMoney(forecast.monthlyTakeHomeCents)}</strong>
          <div className="fd-metric-meta">
            <small>{formatMoney(dataset.persona.grossAnnualIncomeCents)} gross salary · synthetic demo, not a tax estimate</small>
          </div>
        </article>
        <article className={forecast.expectedMonthlySurplusCents >= 0 ? "positive" : "warning"}>
          <span className="fd-metric-label">Expected monthly surplus</span>
          <strong className="fd-metric-value">{formatMoney(forecast.expectedMonthlySurplusCents)}</strong>
          <div className="fd-metric-meta">
            <small>After spending and checking-funded investing</small>
          </div>
        </article>
        <article>
          <span className="fd-metric-label">Lowest projected balance</span>
          <strong className="fd-metric-value">{formatMoney(forecast.lowestBalanceCents)}</strong>
          <div className="fd-metric-meta">
            <small>{new Date(`${forecast.lowestBalanceDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · checking</small>
            <MetricHint>Lowest point on the forecast — as long as it stays above the buffer, the plan holds.</MetricHint>
          </div>
        </article>
        <article>
          <span className="fd-metric-label">Liquid cash</span>
          <strong className="fd-metric-value">{formatMoney(liquidCashCents)}</strong>
          <div className="fd-metric-meta">
            <small>Checking + savings</small>
          </div>
        </article>
      </section>

      <section className="fd-card fd-cashflow-chart-card">
        <div className="fd-card-heading"><div><span className="fd-eyebrow">Forward cash flow</span><h2>Income still covers the modeled outflow</h2><p>Solid bars are known or modeled amounts. Internal savings transfers are excluded from net cash flow.</p></div><div className="fd-horizon" aria-label="Forecast horizon">{([30, 60, 90] as const).map((option) => <button key={option} onClick={() => setDays(option)} className={days === option ? "active" : ""}>{option} days</button>)}</div></div>
        <div className="fd-cashflow-chart" role="img" aria-label={`${days} day monthly income, outflow, and investing projection`}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}><CartesianGrid vertical={false} stroke="rgba(36,54,44,.08)" /><XAxis dataKey="label" tick={{ fontSize: 11, fill: "#65736b" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `$${Math.abs(Number(value) / 100_000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "#7f8b84" }} axisLine={false} tickLine={false} width={38} /><Tooltip formatter={(value) => formatMoney(Math.abs(Number(value)))} /><Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="income" name="Income" fill="#2e765d" radius={[5, 5, 0, 0]} /><Bar dataKey="outflow" name="Spending" fill="#c66f50" radius={[0, 0, 5, 5]} /><Bar dataKey="investing" name="Investing" fill="#c09550" radius={[0, 0, 5, 5]} /></BarChart></ResponsiveContainer>
        </div>
        <div className="fd-month-tabs" aria-label="Select forecast month">{forecast.months.map((month) => <button key={month.month} className={selected?.month === month.month ? "active" : ""} onClick={() => setSelectedMonth(month.month)}>{month.label}</button>)}</div>
        <details className="fd-chart-data"><summary>View forecast as a table</summary><table><thead><tr><th scope="col">Month</th><th scope="col">Income</th><th scope="col">Committed</th><th scope="col">Typical flexible</th><th scope="col">Investing</th><th scope="col">Net</th></tr></thead><tbody>{forecast.months.map((month) => <tr key={month.month}><th scope="row">{month.label}</th><td>{formatMoney(month.incomeCents)}</td><td>{formatMoney(month.committedCents)}</td><td>{formatMoney(month.flexibleCents)}</td><td>{formatMoney(month.investmentCents)}</td><td>{formatMoney(month.netCents)}</td></tr>)}</tbody></table></details>
      </section>

      <section className="fd-cashflow-details">
        <article className="fd-card fd-month-detail">
          <div className="fd-card-heading"><div><span className="fd-eyebrow">Selected month</span><h2>{selected?.label ?? "Forecast"}</h2></div><CalendarClock size={17} /></div>
          {selected && <div className="fd-month-breakdown"><div><span>Take-home income</span><strong>+{formatMoney(selected.incomeCents)}</strong></div><div><span>Known commitments</span><strong>−{formatMoney(selected.committedCents)}</strong></div><div><span>Typical flexible spending</span><strong>−{formatMoney(selected.flexibleCents)}</strong></div><div><span>Roth + brokerage from checking</span><strong>−{formatMoney(selected.investmentCents)}</strong></div><div className="total"><span>Expected net</span><strong>{selected.netCents >= 0 ? "+" : "−"}{formatMoney(Math.abs(selected.netCents))}</strong></div></div>}
          <button className="fd-inline-action" onClick={() => onAskBrain(`Explain the ${selected?.label ?? "next month"} cash-flow projection`)}>Ask the Brain about this month<ChevronRight size={14} /></button>
        </article>
        <article className="fd-card fd-assumptions-card"><span className="fd-insight-icon"><Info size={17} /></span><div><span className="fd-eyebrow">How this forecast works</span><h2>Known money and estimated money stay separate.</h2><ul><li>Salary and scheduled obligations use the deterministic recurring ledger.</li><li>Flexible spending uses the trailing three complete months.</li><li>The $1,000 savings transfer moves liquid cash but does not reduce net worth.</li><li>401(k) and HSA payroll contributions are not deducted from take-home again.</li></ul></div></article>
      </section>

      <details className="fd-card fd-runway-details">
        <summary><span><WalletCards size={17} /><span><strong>View account runway</strong><small>Daily checking balance, known events, and the protected buffer</small></span></span><ChevronRight size={16} /></summary>
        <div className="fd-runway-summary"><div><span>Lowest checking</span><strong>{formatMoney(forecast.lowestBalanceCents)}</strong><small>{new Date(`${forecast.lowestBalanceDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></div><div><span>Projected liquid cash</span><strong>{formatMoney(forecast.projectedLiquidCashCents)}</strong><small>At the end of the selected model</small></div><div><span>Checking buffer</span><strong>{formatMoney(dataset.persona.reserveFloorCents)}</strong><small>Emergency savings remains separate</small></div></div>
        <ForecastChart points={forecast.runway.points} reserveFloorCents={forecast.runway.reserveFloorCents} />
      </details>

      <section className="fd-decision-cta"><span className="fd-decision-icon"><CircleDollarSign size={20} /></span><div><span className="fd-eyebrow">Test a decision</span><h2>Thinking about a car, trip, or large purchase?</h2><p>The Financial Brain can compare upfront and monthly costs with this exact forecast.</p></div><button onClick={() => onAskBrain("Can I afford a car next month?")}>Run a decision check</button></section>
    </div>
  );
}
