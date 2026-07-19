"use client";

import { ArrowRight, BarChart3, Bot, BriefcaseBusiness, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";
import type { ForecastResult } from "@/lib/finance/types";
import { formatMoney } from "@/lib/finance/engine";
import { BrandLogo } from "@/components/brand/brand-logo";

export function Landing({ forecast, onEnter }: { forecast: ForecastResult; onEnter: () => void }) {
  return (
    <main className="landing">
      <section className="landing-shell">
        <div className="landing-copy">
          <BrandLogo />

          <div>
            <div className="landing-kicker">Your financial operating system</div>
            <h1 className="landing-title serif">Money,<br /><em>anticipated.</em></h1>
            <p className="landing-subtitle">Ask one question and see spending, income, cash flow, and investments connect into a clear next step.</p>
            <button className="primary-button" onClick={onEnter}>
              Login as Demo User
              <span className="button-icon"><ArrowRight size={15} /></span>
            </button>
            <div className="landing-note"><span className="landing-note-dot" />No account or financial credentials required</div>
          </div>

          <div className="landing-note"><ShieldCheck size={14} />12 months of realistic, private demo data</div>
        </div>

        <div className="landing-visual" aria-label="FinDex Financial Brain preview">
          <div className="preview-window brain-preview-window">
            <div className="preview-toolbar"><div className="preview-dots"><span /><span /><span /></div><div className="preview-pill"><Sparkles size={10} />Financial Brain</div></div>
            <div className="landing-brain-preview">
              <span className="preview-brain-orb"><Bot size={18} /></span>
              <div className="landing-eyebrow">Your financial starting point</div>
              <h2 className="serif">What do you want<br />your money to do?</h2>
              <div className="preview-composer">Ask about your money, or test a decision…<span><ArrowRight size={12} /></span></div>
              <div className="preview-prompts"><span>Can I afford a car?</span><span>Where did my money go?</span></div>
            </div>
            <div className="preview-glances"><div><ReceiptText size={12} /><span>Safe to spend<strong>{formatMoney(forecast.safeToSpendNowCents)}</strong></span></div><div><BriefcaseBusiness size={12} /><span>Net worth<strong>$180,558</strong></span></div><div><BarChart3 size={12} /><span>90-day outlook<strong>Covered</strong></span></div></div>
          </div>
        </div>
      </section>
    </main>
  );
}
