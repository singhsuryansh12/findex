"use client";

import { ArrowRight, Bot, ShieldCheck } from "lucide-react";
import type { ForecastResult } from "@/lib/finance/types";
import { formatMoney } from "@/lib/finance/engine";
import { BrandLogo } from "@/components/brand/brand-logo";

export function Landing({ forecast, onEnter }: { forecast: ForecastResult; onEnter: () => void }) {
  const bars = forecast.points.filter((_, index) => index % 2 === 0).slice(0, 16);
  const maximum = Math.max(...bars.map((point) => point.projectedBalanceCents));
  const minimum = Math.min(...bars.map((point) => point.projectedBalanceCents));
  return (
    <main className="landing">
      <section className="landing-shell">
        <div className="landing-copy">
          <BrandLogo />

          <div>
            <div className="landing-kicker">Your financial operating system</div>
            <h1 className="landing-title serif">Money,<br /><em>anticipated.</em></h1>
            <p className="landing-subtitle">
              See what happens next, ask anything about your money, and build the exact financial tools you need—live.
            </p>
            <button className="primary-button" onClick={onEnter}>
              Login as Demo User
              <span className="button-icon"><ArrowRight size={15} /></span>
            </button>
            <div className="landing-note"><span className="landing-note-dot" />No account or financial credentials required</div>
          </div>

          <div className="landing-note"><ShieldCheck size={14} />12 months of realistic, private demo data</div>
        </div>

        <div className="landing-visual" aria-label="FinDex dashboard preview">
          <div className="preview-window">
            <div className="preview-toolbar">
              <div className="preview-dots"><span /><span /><span /></div>
              <div className="preview-pill">Next 30 days</div>
            </div>
            <div className="preview-summary">
              <div>
                <div className="landing-eyebrow">Safe to spend</div>
                <div className="preview-number serif">{formatMoney(forecast.safeToSpendNowCents)}</div>
                <div className="preview-caption">after upcoming bills and your $1,500 reserve</div>
              </div>
              <div className="preview-insight">
                <div className="preview-insight-row">
                  <span className="preview-insight-icon"><Bot size={15} /></span>
                  <div><strong>Cashflow looks healthy</strong><p>Your lowest point arrives on {forecast.lowestBalanceDate.slice(5).replace("-", "/")}.</p></div>
                </div>
              </div>
            </div>
            <div className="preview-chart" aria-hidden="true">
              {bars.map((point, index) => {
                const height = 48 + ((point.projectedBalanceCents - minimum) / Math.max(1, maximum - minimum)) * 120;
                return <span key={point.date} className={`preview-bar ${index === bars.length - 3 ? "accent" : ""}`} style={{ height }} />;
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
