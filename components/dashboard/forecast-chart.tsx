"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastPoint } from "@/lib/finance/types";
import { compactDate } from "@/lib/finance/dates";
import { formatMoney, formatMoneyPrecise } from "@/lib/finance/engine";

function ForecastTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ForecastPoint }> }) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{compactDate(point.date)}</div>
      <div className="chart-tooltip-value"><span>Projected balance</span><strong>{formatMoneyPrecise(point.projectedBalanceCents)}</strong></div>
      <div className="chart-tooltip-value"><span>Safe to spend</span><strong>{formatMoneyPrecise(point.safeToSpendCents)}</strong></div>
      {point.events.map((event) => (
        <div className="tooltip-event" key={event.id}>
          <span>{event.name}</span>
          <strong>{event.amountCents > 0 ? "+" : ""}{formatMoneyPrecise(event.amountCents)}</strong>
        </div>
      ))}
    </div>
  );
}

export function ForecastChart({ points, reserveFloorCents }: { points: ForecastPoint[]; reserveFloorCents: number }) {
  return (
    <div className="forecast-scroll">
      <div className="forecast-chart" aria-label="Thirty day projected balance and safe-to-spend chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 16, right: 10, left: -18, bottom: 0 }} accessibilityLayer>
            <defs>
              <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3d9272" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#3d9272" stopOpacity={0.015} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(36,54,44,.07)" vertical={false} />
            <XAxis dataKey="dayLabel" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#8a958f" }} interval={5} dy={8} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#8a958f" }} tickFormatter={(value) => formatMoney(value)} width={58} />
            <Tooltip content={<ForecastTooltip />} cursor={{ stroke: "rgba(46,118,93,.25)", strokeDasharray: "4 4" }} />
            <ReferenceLine y={reserveFloorCents} stroke="#c66f50" strokeDasharray="4 5" strokeOpacity={0.55} />
            <Area type="monotone" dataKey="projectedBalanceCents" stroke="none" fill="url(#balanceFill)" />
            <Line type="monotone" dataKey="projectedBalanceCents" stroke="#285c49" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#285c49", stroke: "white", strokeWidth: 2 }} />
            <Line type="monotone" dataKey="safeToSpendCents" stroke="#c09550" strokeWidth={1.7} strokeDasharray="5 5" dot={false} />
            {points.flatMap((point) => point.events.map((event) => (
              <ReferenceDot
                key={event.id}
                x={point.dayLabel}
                y={point.projectedBalanceCents}
                r={3.5}
                fill={event.kind === "income" ? "#3d9272" : "#c66f50"}
                stroke="#fffefa"
                strokeWidth={1.5}
              />
            )))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
