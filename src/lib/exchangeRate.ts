import { z } from "zod";

const positiveRate = z.number().positive();
const date = z.iso.date();
const decimalRate = z.string().regex(/^\d+(?:\.\d{1,8})?$/).transform(Number).pipe(positiveRate);

const referenceSeriesSchema = z.object({
  data: z.object({
    currency: z.literal("USD"),
    quoteCurrency: z.literal("DOP"),
    entityId: z.literal("bcrd"),
    kind: z.literal("reference"),
    points: z.array(
      z.object({
        date,
        buy: decimalRate.nullable(),
        sell: decimalRate.nullable(),
        buyDatePrecision: z.enum(["day", "datetime", "unknown"]).nullable(),
        sellDatePrecision: z.enum(["day", "datetime", "unknown"]).nullable(),
      }),
    ),
  }),
});

const observationSchema = z.object({
  rate: positiveRate,
  effectiveDate: date,
  previousRate: positiveRate.nullable(),
});

const cacheSchema = z.object({
  buy: observationSchema.nullable(),
  sell: observationSchema.nullable(),
});

export type ExchangeRateSide = "buy" | "sell";
export type ExchangeRateCache = z.infer<typeof cacheSchema>;

export interface ExchangeRateSnapshot {
  rate: number;
  source: string;
  effectiveDate: string | null;
  side: ExchangeRateSide | null;
  variationPercent: number | null;
}

export const EXCHANGE_RATE_SOURCE = "BCRD vía Divisa.do";
export const exchangeRateFormat = new Intl.NumberFormat("es-DO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

export function parseExchangeRateCache(value: string | null): ExchangeRateCache | null {
  if (!value) return null;
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseReferenceSeries(value: unknown): ExchangeRateCache {
  const result = referenceSeriesSchema.safeParse(value);
  if (!result.success) throw new Error("Divisa.do devolvió una serie USD/DOP con formato inesperado.");

  const points = result.data.data.points.sort((a, b) => b.date.localeCompare(a.date));
  function latest(side: ExchangeRateSide) {
    const precision = side === "buy" ? "buyDatePrecision" : "sellDatePrecision";
    const observations = points.flatMap((point) => {
      const rate = point[side];
      return rate !== null && (point[precision] === "day" || point[precision] === "datetime")
        ? [{ rate, effectiveDate: point.date }]
        : [];
    });
    const current = observations[0];
    if (!current) return null;
    const previous = observations.find(({ effectiveDate }) => effectiveDate < current.effectiveDate);
    return { ...current, previousRate: previous?.rate ?? null };
  }

  return { buy: latest("buy"), sell: latest("sell") };
}

export function automaticRateSnapshot(
  cache: ExchangeRateCache | null,
  side: ExchangeRateSide,
): ExchangeRateSnapshot | null {
  const observation = cache?.[side];
  if (!observation) return null;
  return {
    rate: observation.rate,
    source: EXCHANGE_RATE_SOURCE,
    effectiveDate: observation.effectiveDate,
    side,
    variationPercent: observation.previousRate === null
      ? null
      : ((observation.rate - observation.previousRate) / observation.previousRate) * 100,
  };
}
