import { z } from "zod";

export const settingsFormSchema = z.object({
  hourlyRate: z.coerce.number().min(0, "No puede ser negativo"),
  currency: z.enum(["DOP", "USD"]),
  /** Cuántos DOP equivalen a 1 USD — usado para convertir la tarifa al cambiar de moneda en el formulario. */
  exchangeRateDopPerUsd: z.coerce.number().min(0.01, "Debe ser mayor a 0"),
  exchangeRateMode: z.enum(["manual", "automatic"]),
  exchangeRateSide: z.enum(["buy", "sell"]),
  freelancerName: z.string().trim(),
  freelancerTagline: z.string(),
  freelancerEmail: z.string(),
  freelancerPhone: z.string(),
  freelancerPortfolio: z.string(),
  freelancerHandle: z.string(),
  /** Texto por defecto de "Métodos de pago" para cotizaciones nuevas (ej. efectivo, PayPal). */
  paymentMethods: z.string(),
  /** Datos de la cuenta que recibe transferencias en cada moneda. */
  transferAccountDop: z.string(),
  transferAccountUsd: z.string(),
});

// Igual que en features/quote/schema.ts: z.coerce.number() hace que el tipo
// de entrada (lo que RHF maneja mientras se escribe) difiera del de salida
// (lo que llega a onSubmit ya validado).
export type SettingsFormValues = z.output<typeof settingsFormSchema>;
export type SettingsFormInput = z.input<typeof settingsFormSchema>;
