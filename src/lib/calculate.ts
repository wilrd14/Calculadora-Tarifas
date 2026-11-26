import { addMonths } from "./date";

export interface QuoteItemCalcInput {
  hours: number;
}

export interface AdditionalChargeCalcInput {
  amount: number;
}

export interface QuoteCalculationInput {
  items: QuoteItemCalcInput[];
  hourlyRate: number;
  additionalCharges: AdditionalChargeCalcInput[];
  discountPercent: number;
  /** Suma de los % de los multiplicadores de complejidad marcados (ej. 15 + 20 = 35). */
  complexityMultiplierPercent?: number;
}

export interface QuoteCalculationResult {
  totalHours: number;
  /** Horas × tarifa, antes de aplicar los multiplicadores de complejidad. */
  laborSubtotal: number;
  /** Monto que suman los multiplicadores de complejidad sobre `laborSubtotal`. */
  complexityAmount: number;
  /** Horas × tarifa ya con los multiplicadores de complejidad aplicados. */
  itemsSubtotal: number;
  additionalChargesTotal: number;
  /** Subtotal antes de descuento (ítems con multiplicadores + cargos adicionales). */
  subtotal: number;
  discountAmount: number;
  total: number;
}

/**
 * Cálculo del desglose de una cotización.
 * laborSubtotal = Σ(horas × tarifa/hora); itemsSubtotal = laborSubtotal ×
 * (1 + % multiplicadores de complejidad); subtotal = itemsSubtotal + cargos
 * adicionales; total = subtotal − descuento.
 */
export function calculateQuote(
  input: QuoteCalculationInput,
): QuoteCalculationResult {
  const totalHours = sum(input.items.map((item) => item.hours));
  const laborSubtotal = totalHours * safeNumber(input.hourlyRate);
  const complexityAmount =
    laborSubtotal * (safeNumber(input.complexityMultiplierPercent) / 100);
  const itemsSubtotal = laborSubtotal + complexityAmount;
  const additionalChargesTotal = sum(
    input.additionalCharges.map((charge) => charge.amount),
  );
  const subtotal = itemsSubtotal + additionalChargesTotal;
  const discountAmount = subtotal * (safeNumber(input.discountPercent) / 100);
  const total = subtotal - discountAmount;

  return {
    totalHours,
    laborSubtotal,
    complexityAmount,
    itemsSubtotal,
    additionalChargesTotal,
    subtotal,
    discountAmount,
    total,
  };
}

export interface PaymentScheduleRow {
  label: string;
  date: Date;
  amount: number;
  /** Porción del total (0–100) que representa este pago. */
  percent: number;
}

/**
 * Anticipo (% del total, al aceptar) + el resto en cuotas mensuales iguales.
 * Con anticipo las cuotas empiezan un mes después; sin anticipo la primera
 * cuota es en la fecha de inicio. Se calcula en centavos y la última cuota
 * absorbe el redondeo, así la suma siempre es exactamente el total.
 * Pago único (sin anticipo y 1 cuota) devuelve [] — no hay nada que repartir.
 */
export function calculatePaymentSchedule(
  total: number,
  downPaymentPercent: number,
  installments: number,
  startDate: Date,
): PaymentScheduleRow[] {
  const count = Math.max(1, Math.min(12, Math.floor(safeNumber(installments)) || 1));
  const downPercent = Math.max(0, Math.min(100, safeNumber(downPaymentPercent)));
  if (downPercent === 0 && count === 1) return [];

  const totalCents = Math.round(safeNumber(total) * 100);
  const downCents = Math.round((totalCents * downPercent) / 100);
  const restCents = totalCents - downCents;
  const percentOf = (cents: number) => (totalCents === 0 ? 0 : (cents / totalCents) * 100);

  const rows: PaymentScheduleRow[] = [];
  if (downCents > 0) {
    rows.push({ label: "Anticipo", date: startDate, amount: downCents / 100, percent: percentOf(downCents) });
  }
  if (restCents > 0) {
    const base = Math.floor(restCents / count);
    const offset = downCents > 0 ? 1 : 0;
    for (let i = 0; i < count; i++) {
      const cents = i === count - 1 ? restCents - base * (count - 1) : base;
      rows.push({
        label: `Cuota ${i + 1} de ${count}`,
        date: addMonths(startDate, i + offset),
        amount: cents / 100,
        percent: percentOf(cents),
      });
    }
  }
  return rows;
}

function safeNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + safeNumber(value), 0);
}
