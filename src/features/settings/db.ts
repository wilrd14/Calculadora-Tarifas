import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../../lib/db";
import type { Currency } from "../../lib/currency";
import {
  automaticRateSnapshot,
  parseExchangeRateCache,
  parseReferenceSeries,
  type ExchangeRateCache,
  type ExchangeRateSnapshot,
} from "../../lib/exchangeRate";
import type { SettingsFormValues } from "./schema";

export type { ExchangeRateSnapshot } from "../../lib/exchangeRate";

/** Fila fija (siempre "default") de la tabla `settings` — un solo usuario, sin cuentas. */
const SETTINGS_ROW_ID = "default";

export interface FreelancerProfile {
  name: string;
  tagline: string;
  email: string;
  phone: string;
  portfolio: string;
  handle: string;
}

export type AppSettings = SettingsFormValues & { exchangeRateCache: ExchangeRateCache | null };

interface RawSettingsRow {
  hourly_rate: number;
  currency: string;
  exchange_rate_dop_per_usd: number;
  exchange_rate_mode: string;
  exchange_rate_side: string;
  exchange_rate_cache_json: string | null;
  freelancer_name: string;
  freelancer_tagline: string;
  freelancer_email: string;
  freelancer_phone: string;
  freelancer_portfolio: string;
  freelancer_handle: string;
  payment_methods: string;
  transfer_account_dop: string;
  transfer_account_usd: string;
}

/** Lee la configuración guardada (tarifa/moneda por defecto + datos del freelancer). */
export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.select<RawSettingsRow[]>(
    "SELECT * FROM settings WHERE id = $1",
    [SETTINGS_ROW_ID],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("No se encontró la fila de configuración en la base de datos.");
  }
  return {
    hourlyRate: row.hourly_rate,
    currency: row.currency as Currency,
    exchangeRateDopPerUsd: row.exchange_rate_dop_per_usd,
    exchangeRateMode: row.exchange_rate_mode === "automatic" ? "automatic" : "manual",
    exchangeRateSide: row.exchange_rate_side === "sell" ? "sell" : "buy",
    exchangeRateCache: parseExchangeRateCache(row.exchange_rate_cache_json),
    freelancerName: row.freelancer_name,
    freelancerTagline: row.freelancer_tagline,
    freelancerEmail: row.freelancer_email,
    freelancerPhone: row.freelancer_phone,
    freelancerPortfolio: row.freelancer_portfolio,
    freelancerHandle: row.freelancer_handle,
    paymentMethods: row.payment_methods,
    transferAccountDop: row.transfer_account_dop,
    transferAccountUsd: row.transfer_account_usd,
  };
}

/** Guarda la configuración editada desde la pantalla de Configuración. */
export async function saveSettings(settings: SettingsFormValues): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE settings SET
      hourly_rate = $1,
      currency = $2,
      exchange_rate_dop_per_usd = $3,
      freelancer_name = $4,
      freelancer_tagline = $5,
      freelancer_email = $6,
      freelancer_phone = $7,
      freelancer_portfolio = $8,
      freelancer_handle = $9,
      exchange_rate_mode = $10,
      exchange_rate_side = $11,
      payment_methods = $12,
      transfer_account_dop = $13,
      transfer_account_usd = $14
    WHERE id = $15`,
    [
      settings.hourlyRate,
      settings.currency,
      settings.exchangeRateDopPerUsd,
      settings.freelancerName,
      settings.freelancerTagline,
      settings.freelancerEmail,
      settings.freelancerPhone,
      settings.freelancerPortfolio,
      settings.freelancerHandle,
      settings.exchangeRateMode,
      settings.exchangeRateSide,
      settings.paymentMethods,
      settings.transferAccountDop,
      settings.transferAccountUsd,
      SETTINGS_ROW_ID,
    ],
  );
}

export function getEffectiveExchangeRate(settings: AppSettings): ExchangeRateSnapshot {
  if (settings.exchangeRateMode === "automatic") {
    const snapshot = automaticRateSnapshot(settings.exchangeRateCache, settings.exchangeRateSide);
    if (snapshot) return snapshot;
  }
  return {
    rate: settings.exchangeRateDopPerUsd,
    source: "Manual",
    effectiveDate: null,
    side: null,
    variationPercent: null,
  };
}

let rateRefresh: Promise<ExchangeRateCache> | null = null;

async function updateExchangeRateCache(): Promise<ExchangeRateCache> {
  const received = parseReferenceSeries(await invoke<unknown>("fetch_exchange_rates"));
  if (!received.buy && !received.sell) {
    throw new Error("Divisa.do no tiene publicaciones recientes del Banco Central.");
  }
  const { exchangeRateCache: previous } = await getSettings();

  // Las publicaciones sin dato o con una fecha anterior conservan la última observación local.
  for (const side of ["buy", "sell"] as const) {
    const saved = previous?.[side];
    const next = received[side];
    if (saved && (!next || saved.effectiveDate > next.effectiveDate)) {
      received[side] = saved;
    }
  }

  const db = await getDb();
  await db.execute(
    "UPDATE settings SET exchange_rate_cache_json = $1 WHERE id = $2",
    [JSON.stringify(received), SETTINGS_ROW_ID],
  );
  return received;
}

export async function refreshExchangeRate(
  settings?: Pick<AppSettings, "exchangeRateSide">,
): Promise<ExchangeRateSnapshot> {
  const { exchangeRateSide } = settings ?? await getSettings();
  if (!rateRefresh) {
    rateRefresh = updateExchangeRateCache().finally(() => { rateRefresh = null; });
  }
  const snapshot = automaticRateSnapshot(await rateRefresh, exchangeRateSide);
  if (!snapshot) throw new Error("El Banco Central no publicó una tasa para la modalidad seleccionada.");
  return snapshot;
}

/** Datos del freelancer, en el shape que espera `QuoteDocument` para el PDF. */
export function settingsToFreelancerProfile(
  settings: SettingsFormValues,
): FreelancerProfile {
  return {
    name: settings.freelancerName,
    tagline: settings.freelancerTagline,
    email: settings.freelancerEmail,
    phone: settings.freelancerPhone,
    portfolio: settings.freelancerPortfolio,
    handle: settings.freelancerHandle,
  };
}
