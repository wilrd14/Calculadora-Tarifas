import { useId, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { calculatePaymentSchedule, calculateQuote } from "../lib/calculate";
import { formatCurrency } from "../lib/currency";
import { formatDateDMY } from "../lib/date";
import { sumComplexityMultipliers } from "../features/quote/complexityMultipliers";
import { SCOPE_TIERS } from "../features/quote/scopeTiers";
import type { QuoteFormInput } from "../features/quote/schema";

/** Desglose en tiempo real (subtotal, cargos, descuento y total) mientras se llena el formulario. */
export function QuotePreview({ preparing, message }: {
  preparing: boolean;
  message?: { text: string; error: boolean };
}) {
  const breakdownId = useId();
  const [expanded, setExpanded] = useState(false);
  const { control } = useFormContext<QuoteFormInput>();
  const items = useWatch({ control, name: "items" });
  const hourlyRate = useWatch({ control, name: "hourlyRate" });
  const complexityMultiplierIds = useWatch({
    control,
    name: "complexityMultiplierIds",
  });
  const additionalCharges = useWatch({ control, name: "additionalCharges" });
  const discountPercent = useWatch({ control, name: "discountPercent" });
  const currency = useWatch({ control, name: "currency" });
  const downPaymentPercent = useWatch({ control, name: "downPaymentPercent" });
  const installments = useWatch({ control, name: "installments" });

  const [scopeTierId, setScopeTierId] = useState<string | null>(null);

  const complexityMultiplierPercent = sumComplexityMultipliers(
    complexityMultiplierIds ?? [],
  );

  const result = calculateQuote({
    items: (items ?? []).map((item) => ({ hours: Number(item?.hours) || 0 })),
    hourlyRate: Number(hourlyRate) || 0,
    complexityMultiplierPercent,
    additionalCharges: (additionalCharges ?? []).map((charge) => ({
      amount: Number(charge?.amount) || 0,
    })),
    discountPercent: Number(discountPercent) || 0,
  });

  const schedule = calculatePaymentSchedule(
    result.total,
    Number(downPaymentPercent) || 0,
    Number(installments) || 1,
    new Date(),
  );

  const scopeTier = SCOPE_TIERS.find((tier) => tier.id === scopeTierId);
  const scopeStatus = scopeTier
    ? result.totalHours < scopeTier.minHours
      ? "por debajo del rango"
      : result.totalHours > scopeTier.maxHours
        ? "por encima del rango"
        : "dentro del rango"
    : null;

  return (
    <aside className="quote-summary" aria-label="Resumen de la cotización">
      <div className="summary-breakdown" id={breakdownId} data-expanded={expanded}>
        <h2 className="text-base font-semibold">Desglose de la cotización</h2>
        <dl className="my-3 grid gap-2 text-sm amount">
          <Row label="Horas estimadas" value={`${result.totalHours} h`} />
          <Row label="Mano de obra" value={formatCurrency(result.laborSubtotal, currency)} />
          {complexityMultiplierPercent > 0 && (
            <Row label={`Complejidad (+${complexityMultiplierPercent}%)`} value={formatCurrency(result.complexityAmount, currency)} />
          )}
          <Row label="Cargos adicionales" value={formatCurrency(result.additionalChargesTotal, currency)} />
          <Row label="Subtotal" value={formatCurrency(result.subtotal, currency)} />
          <Row label={`Descuento (${Number(discountPercent) || 0}%)`} value={`− ${formatCurrency(result.discountAmount, currency)}`} />
        </dl>
        {schedule.length > 0 && (
          <>
            <p className="text-xs font-medium text-text-soft">Calendario de pagos</p>
            <dl className="my-2 grid gap-2 text-sm amount">
              {schedule.map((row) => (
                <Row
                  key={row.label}
                  label={`${row.label} · ${formatDateDMY(row.date)}`}
                  value={formatCurrency(row.amount, currency)}
                />
              ))}
            </dl>
          </>
        )}
        <p className="text-xs font-medium text-text-soft">Referencia de alcance</p>
      {/* Nivel de alcance: solo una referencia de horas, no se guarda. */}
      <div className="my-2 flex flex-wrap gap-1.5">
        {SCOPE_TIERS.map((tier) => (
          <button
            key={tier.id}
            type="button"
            aria-pressed={scopeTierId === tier.id}
            onClick={() =>
              setScopeTierId((current) => (current === tier.id ? null : tier.id))
            }
            className={
              scopeTierId === tier.id
                ? "rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-xs text-accent"
                : "rounded-md border border-border px-2.5 py-1 text-xs text-text-faint hover:text-text-soft"
            }
          >
            {tier.label}
          </button>
        ))}
      </div>
      {scopeTier && (
        <p className="mt-1.5 text-xs text-text-faint">
          {result.totalHours}h — {scopeStatus} de {scopeTier.label} (
          {scopeTier.minHours}–{scopeTier.maxHours}h)
        </p>
      )}

      </div>
      <div className="summary-actions">
        <div className="summary-price rounded-md bg-accent-soft px-3 py-2 amount">
          <p className="text-xs text-text-soft">Total estimado · {result.totalHours} h</p>
          <strong>{formatCurrency(result.total, currency)}</strong>
          <span className="ml-2 text-xs font-medium text-text-soft">{currency}</span>
        </div>
        <button
          type="button"
          className="secondary-action summary-toggle"
          aria-controls={breakdownId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Cerrar desglose" : "Ver desglose"}
        </button>
        <button type="submit" className="primary-action" disabled={preparing}>
          {preparing ? "Preparando PDF…" : "Vista previa PDF"}
        </button>
      </div>
      <p className={message ? `summary-output text-sm ${message.error ? "text-danger" : "text-success"}` : ""} role="status">
        {message?.text}
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2 text-text-soft">
      <dt>{label}</dt>
      <dd className="text-right text-text wrap-anywhere">{value}</dd>
    </div>
  );
}
