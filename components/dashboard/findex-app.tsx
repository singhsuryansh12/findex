"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarDays,
  CreditCard,
  Home,
  Landmark,
  LayoutDashboard,
  ListFilter,
  Menu,
  ReceiptText,
  Repeat2,
  Settings,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Utensils,
  WalletCards,
} from "lucide-react";
import type { DemoDataset } from "@/lib/finance/types";
import { formatMoney, getCategoryName, getMerchantName } from "@/lib/finance/engine";
import { compactDate } from "@/lib/finance/dates";
import type { WidgetArtifact } from "@/lib/widgets/contracts";
import { BrainPanel } from "@/components/brain/brain-panel";
import { BrandLogo } from "@/components/brand/brand-logo";
import { GeneratedWidgetCard } from "@/components/widgets/generated-widget-card";
import { ForecastChart } from "./forecast-chart";
import { Landing } from "./landing";

type Snapshot = ReturnType<typeof import("@/lib/finance/engine").getFinancialSnapshot>;

const SESSION_KEY = "findex-demo-entered-v1";
const WIDGET_KEY = "findex-widget-artifact-v1";

export function FinDexApp({ dataset, snapshot }: { dataset: DemoDataset; snapshot: Snapshot }) {
  const [entered, setEntered] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [artifact, setArtifact] = useState<WidgetArtifact | null>(null);
  const [widgetPrompt, setWidgetPrompt] = useState<string | null>(null);
  const generatedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setEntered(window.localStorage.getItem(SESSION_KEY) === "true");
      const storedArtifact = window.localStorage.getItem(WIDGET_KEY);
      if (storedArtifact) {
        try { setArtifact(JSON.parse(storedArtifact) as WidgetArtifact); } catch { window.localStorage.removeItem(WIDGET_KEY); }
      }
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  const enterDemo = () => {
    window.localStorage.setItem(SESSION_KEY, "true");
    setEntered(true);
  };

  const handleWidget = (nextArtifact: WidgetArtifact) => {
    setArtifact(nextArtifact);
    window.localStorage.setItem(WIDGET_KEY, JSON.stringify(nextArtifact));
    window.setTimeout(() => generatedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  };

  const buildTool = () => {
    setWidgetPrompt("Build me an interactive FIRE calculator");
    setBrainOpen(true);
  };

  const resetDemo = () => {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(WIDGET_KEY);
    setArtifact(null);
    setBrainOpen(false);
    setEntered(false);
  };

  if (!hydrated || !entered) {
    return <Landing forecast={snapshot.forecast} onEnter={enterDemo} />;
  }

  const recentTransactions = [...dataset.transactions]
    .filter((transaction) => transaction.categoryId !== "transfer")
    .sort((a, b) => b.postedOn.localeCompare(a.postedOn))
    .slice(0, 6);
  const upcoming = snapshot.forecast.events.filter((event) => event.kind === "liability").slice(0, 5);
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <BrandLogo compact small />
        <nav className="sidebar-nav">
          <button className="nav-button active" aria-label="Overview"><LayoutDashboard size={18} /></button>
          <button className="nav-button" aria-label="Cashflow"><BarChart3 size={18} /></button>
          <button className="nav-button" aria-label="Transactions"><ReceiptText size={18} /></button>
          <button className="nav-button" aria-label="Goals"><Target size={18} /></button>
        </nav>
        <button className="nav-button" aria-label="Reset demo" onClick={resetDemo} title="Reset demo"><Settings size={18} /></button>
        <span className="sidebar-avatar" title={dataset.persona.name}>{dataset.persona.initials}</span>
      </aside>

      <div className="app-content">
        <header className="topbar">
          <div>
            <BrandLogo small className="topbar-brand" />
            <div className="topbar-context">Overview&nbsp; / &nbsp;Financial home</div>
          </div>
          <div className="topbar-date"><CalendarDays size={13} />As of {compactDate(dataset.metadata.asOfDate)} · Demo data</div>
        </header>

        <div className="dashboard-grid">
          <main className="dashboard-main">
            <div className="welcome-row">
              <div>
                <div className="section-eyebrow">Your financial pulse</div>
                <h1 className="welcome-title serif">Morning, <span>{dataset.persona.firstName}.</span></h1>
              </div>
              <div className="sync-status">All accounts reconciled</div>
            </div>

            <section className="metric-grid" aria-label="Financial summary">
              <article className="metric-card featured">
                <div className="metric-label"><Sparkles size={12} />Safe to spend</div>
                <div><div className="metric-value">{formatMoney(snapshot.forecast.safeToSpendNowCents)}</div><div className="metric-change">protected through {compactDate(snapshot.forecast.throughDate)}</div></div>
              </article>
              <article className="metric-card">
                <div className="metric-label"><Landmark size={12} />Net worth</div>
                <div><div className="metric-value">{formatMoney(snapshot.netWorthCents)}</div><div className="metric-change"><ArrowUpRight size={9} style={{ display: "inline" }} /> $1,000 saved this month</div></div>
              </article>
              <article className="metric-card">
                <div className="metric-label"><WalletCards size={12} />Liquid cash</div>
                <div><div className="metric-value">{formatMoney(snapshot.liquidCashCents)}</div><div className="metric-change">across 2 cash accounts</div></div>
              </article>
              <article className="metric-card">
                <div className="metric-label"><ReceiptText size={12} />Monthly spend</div>
                <div><div className="metric-value">{formatMoney(snapshot.lastMonthSpendingCents)}</div><div className={`metric-change ${snapshot.spendingDeltaPercent > 0 ? "negative" : ""}`}>{Math.abs(snapshot.spendingDeltaPercent)}% {snapshot.spendingDeltaPercent > 0 ? "above" : "below"} recent average</div></div>
              </article>
            </section>

            <section className="panel forecast-panel">
              <div className="panel-header">
                <div><div className="section-eyebrow">Predictive cashflow</div><h2 className="panel-title">The next 30 days, already accounted for</h2><div className="panel-subtitle">Known income and liabilities projected from your current checking balance.</div></div>
                <div className="legend"><span><i style={{ background: "#285c49" }} />Projected</span><span><i style={{ background: "#c09550" }} />Safe to spend</span><span><i style={{ background: "#c66f50" }} />Reserve</span></div>
              </div>
              <ForecastChart points={snapshot.forecast.points} reserveFloorCents={snapshot.forecast.reserveFloorCents} />
            </section>

            <section className="signal-grid" aria-label="Financial signals">
              <article className="signal-card"><div className="signal-icon"><TrendingUp size={16} /></div><h3>Spending is steady</h3><p>Last month finished {Math.abs(snapshot.spendingDeltaPercent)}% {snapshot.spendingDeltaPercent > 0 ? "above" : "below"} your recent average, with no unusual spikes.</p></article>
              <article className="signal-card"><div className="signal-icon"><TrendingDown size={16} /></div><h3>Your lowest point is covered</h3><p>Cash bottoms at {formatMoney(snapshot.forecast.lowestBalanceCents)} on {compactDate(snapshot.forecast.lowestBalanceDate)}, above your reserve.</p></article>
              <article className="signal-card"><div className="signal-icon"><Repeat2 size={16} /></div><h3>{formatMoney(snapshot.recurringMonthlyCents)} recurring</h3><p>Fixed bills and subscriptions are already included in this month’s runway.</p></article>
            </section>

            <section className="lower-grid">
              <article className="panel">
                <div className="panel-header"><div><div className="section-eyebrow">Activity</div><h2 className="panel-title">Latest transactions</h2></div><ListFilter size={15} color="#7f8b84" /></div>
                <div className="transaction-list">
                  {recentTransactions.map((transaction) => (
                    <div className="transaction-row" key={transaction.id}>
                      <span className="transaction-icon">{transaction.categoryId === "dining" ? <Utensils size={14} /> : transaction.categoryId === "income" ? <ArrowDownRight size={14} /> : <CreditCard size={14} />}</span>
                      <div><div className="transaction-name">{getMerchantName(transaction.merchantId)}</div><div className="transaction-meta">{getCategoryName(transaction.categoryId)} · {compactDate(transaction.postedOn)}</div></div>
                      <div className="transaction-amount">{transaction.amountCents > 0 ? "+" : "−"}{formatMoney(Math.abs(transaction.amountCents), 2)}</div>
                    </div>
                  ))}
                </div>
              </article>
              <article className="panel">
                <div className="panel-header"><div><div className="section-eyebrow">Committed</div><h2 className="panel-title">Coming up</h2></div><CalendarDays size={15} color="#7f8b84" /></div>
                <div className="commitment-list">
                  {upcoming.map((event) => (
                    <div className="commitment-row" key={event.id}><div><div className="commitment-name">{event.name}</div><div className="commitment-date">{compactDate(event.date)}</div></div><div className="commitment-amount">−{formatMoney(Math.abs(event.amountCents))}</div></div>
                  ))}
                </div>
              </article>
            </section>

            <div ref={generatedRef} className="generated-section">
              {artifact ? <GeneratedWidgetCard artifact={artifact} onRetry={buildTool} /> : (
                <div className="empty-generated"><div><div className="section-eyebrow">Adaptive workspace</div><h3>Your dashboard can build what it’s missing.</h3><p>Ask the Financial Brain for a calculator, tracker, or personalized projection.</p></div><button className="secondary-button" onClick={buildTool}>Build a FIRE calculator</button></div>
              )}
            </div>
          </main>

          <aside className={`brain-column ${brainOpen ? "mobile-open" : ""}`}>
            <BrainPanel onWidget={handleWidget} initialPrompt={widgetPrompt} onPromptConsumed={() => setWidgetPrompt(null)} onClose={() => setBrainOpen(false)} />
          </aside>
        </div>
      </div>

      <button className="mobile-brain-button" onClick={() => setBrainOpen(true)}><Bot size={16} />Ask FinDex</button>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button className="mobile-nav-button active"><Home size={17} />Home</button>
        <button className="mobile-nav-button"><BarChart3 size={17} />Cashflow</button>
        <button className="mobile-nav-button" onClick={() => setBrainOpen(true)}><Bot size={17} />Brain</button>
        <button className="mobile-nav-button" onClick={resetDemo}><Menu size={17} />Reset</button>
      </nav>
    </div>
  );
}
