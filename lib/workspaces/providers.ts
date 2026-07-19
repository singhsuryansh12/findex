type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Twelve Data ${label} response is malformed.`);
  return value as UnknownRecord;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Twelve Data response is missing numeric ${label}.`);
  return parsed;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTwelveSearch(value: unknown) {
  const payload = record(value, "symbol search");
  const data = Array.isArray(payload.data) ? payload.data : [];
  return {
    items: data.slice(0, 20).map((item) => {
      const row = record(item, "symbol search item");
      return {
        symbol: text(row.symbol),
        name: text(row.instrument_name),
        exchange: text(row.exchange),
        country: text(row.country),
        instrumentType: text(row.instrument_type),
        currency: text(row.currency),
      };
    }).filter((item) => item.symbol),
  };
}

export function normalizeTwelveQuote(value: unknown) {
  const row = record(value, "quote");
  return {
    symbol: text(row.symbol),
    name: text(row.name),
    exchange: text(row.exchange),
    currency: text(row.currency),
    price: number(row.close, "close"),
    change: optionalNumber(row.change),
    percentChange: optionalNumber(row.percent_change),
    previousClose: optionalNumber(row.previous_close),
    open: optionalNumber(row.open),
    high: optionalNumber(row.high),
    low: optionalNumber(row.low),
    volume: optionalNumber(row.volume),
    asOf: text(row.datetime, typeof row.timestamp === "number" ? new Date(row.timestamp * 1_000).toISOString() : ""),
    isMarketOpen: row.is_market_open === true,
  };
}

export function normalizeTwelveTimeSeries(value: unknown) {
  const payload = record(value, "time series");
  const meta = record(payload.meta, "time series metadata");
  if (!Array.isArray(payload.values)) throw new Error("Twelve Data time series response has no values.");
  return {
    symbol: text(meta.symbol),
    interval: text(meta.interval),
    currency: text(meta.currency),
    exchange: text(meta.exchange),
    timezone: text(meta.exchange_timezone, "UTC"),
    points: payload.values.map((item) => {
      const row = record(item, "time series point");
      return {
        datetime: text(row.datetime),
        open: number(row.open, "open"),
        high: number(row.high, "high"),
        low: number(row.low, "low"),
        close: number(row.close, "close"),
        volume: optionalNumber(row.volume),
      };
    }),
  };
}
