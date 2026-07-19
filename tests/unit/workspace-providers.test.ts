import { describe, expect, it } from "vitest";
import { normalizeTwelveQuote, normalizeTwelveSearch, normalizeTwelveTimeSeries } from "@/lib/workspaces/providers";

describe("Twelve Data normalization", () => {
  it("normalizes symbol search fields into a stable shape", () => {
    expect(normalizeTwelveSearch({ data: [{
      symbol: "AAPL", instrument_name: "Apple Inc", exchange: "NASDAQ", country: "United States",
      instrument_type: "Common Stock", currency: "USD",
    }] })).toEqual({ items: [{
      symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", country: "United States",
      instrumentType: "Common Stock", currency: "USD",
    }] });
  });

  it("converts quote and series numeric strings without inventing missing values", () => {
    expect(normalizeTwelveQuote({
      symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", currency: "USD", close: "212.34",
      change: "1.25", percent_change: "0.59", previous_close: "211.09", datetime: "2026-07-17",
      is_market_open: false,
    })).toMatchObject({ symbol: "AAPL", price: 212.34, change: 1.25, percentChange: 0.59, volume: null, isMarketOpen: false });
    expect(normalizeTwelveTimeSeries({
      meta: { symbol: "AAPL", interval: "1day", currency: "USD", exchange: "NASDAQ", exchange_timezone: "America/New_York" },
      values: [{ datetime: "2026-07-17", open: "210", high: "213", low: "209", close: "212.34", volume: "12345" }],
    })).toMatchObject({ symbol: "AAPL", points: [{ close: 212.34, volume: 12345 }] });
  });

  it("rejects malformed provider values instead of labeling them live", () => {
    expect(() => normalizeTwelveQuote({ symbol: "AAPL" })).toThrow("numeric close");
    expect(() => normalizeTwelveTimeSeries({ meta: {}, values: "unavailable" })).toThrow("no values");
  });
});
