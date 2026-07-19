import React, { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Field, Panel, Progress, Slider, Stat } from "./widget-kit";

type Props = {
  data: {
    persona: { age: number };
    aggregates: { netWorthCents: number; monthlySpendingCents: number };
  };
};

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(value);

export default function GeneratedWidget({ data }: Props) {
  const [contribution, setContribution] = useState(1800);
  const [retirementAge, setRetirementAge] = useState(52);
  const [returnRate, setReturnRate] = useState(7);
  const current = data.aggregates.netWorthCents / 100;
  const annualSpend = (data.aggregates.monthlySpendingCents / 100) * 12;
  const target = Math.max(annualSpend * 25, 1);
  const years = Math.max(1, retirementAge - data.persona.age);

  const projection = useMemo(() => {
    const monthlyRate = returnRate / 100 / 12;
    return Array.from({ length: years + 1 }, (_, year) => {
      const months = year * 12;
      const growth = Math.pow(1 + monthlyRate, months);
      const deposits = monthlyRate === 0 ? contribution * months : contribution * ((growth - 1) / monthlyRate);
      const balance = current * growth + deposits;
      return { age: data.persona.age + year, balance: Math.round(balance), target };
    });
  }, [contribution, current, data.persona.age, returnRate, target, years]);

  const projected = projection[projection.length - 1]?.balance ?? current;
  const progress = Math.min(100, Math.round((projected / target) * 100));

  return <Panel>
    <div className="widget-heading">
      <div><div className="eyebrow">Adaptive plan</div><h2>FIRE runway</h2><p>See how today’s choices compound into your independence target.</p></div>
      <div className="target-pill">Target {money(target)}</div>
    </div>
    <div className="stat-grid">
      <Stat label="Projected at retirement" value={money(projected)} tone="positive" />
      <Stat label="Years to compound" value={String(years)} />
      <Stat label="Target funded" value={progress + "%"} />
    </div>
    <Progress value={progress} label={money(projected) + " of " + money(target)} />
    <div className="widget-body">
      <div className="controls">
        <Field label="Monthly contribution" value={money(contribution)}><Slider min={250} max={5000} step={50} value={contribution} onChange={setContribution} /></Field>
        <Field label="Retirement age" value={String(retirementAge)}><Slider min={data.persona.age + 2} max={70} step={1} value={retirementAge} onChange={setRetirementAge} /></Field>
        <Field label="Expected annual return" value={returnRate.toFixed(1) + "%"}><Slider min={2} max={12} step={0.5} value={returnRate} onChange={setReturnRate} /></Field>
      </div>
      <div className="chart-wrap" aria-label="Projected FIRE portfolio by age">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={projection} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs><linearGradient id="fireFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#337b60" stopOpacity={0.3}/><stop offset="100%" stopColor="#337b60" stopOpacity={0.02}/></linearGradient></defs>
            <CartesianGrid stroke="#e8e9e4" vertical={false}/><XAxis dataKey="age" tickLine={false} axisLine={false}/><YAxis tickFormatter={(value: number) => "$" + Math.round(value / 1000) + "k"} tickLine={false} axisLine={false} width={52}/>
            <Tooltip formatter={(value: unknown) => money(Number(value ?? 0))} labelFormatter={(age: React.ReactNode) => "Age " + age}/>
            <Area type="monotone" dataKey="balance" stroke="#2e765d" strokeWidth={2.5} fill="url(#fireFill)"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  </Panel>;
}
