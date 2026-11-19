import { formatCurrency, type Currency } from "../../lib/currency";
import type { QuoteHistoryRecord } from "./db";

type ScopeItem = QuoteHistoryRecord["items"][number];

function scopeDifference(items: ScopeItem[], baseline: ScopeItem[]): ScopeItem[] {
  const remaining = new Map<string, number>();
  const key = ({ name, hours, complexity }: ScopeItem) => JSON.stringify([name, hours, complexity]);
  for (const item of baseline) {
    const signature = key(item);
    remaining.set(signature, (remaining.get(signature) ?? 0) + 1);
  }

  return items.filter((item) => {
    const signature = key(item);
    const count = remaining.get(signature) ?? 0;
    if (!count) return true;
    remaining.set(signature, count - 1);
    return false;
  });
}

export function RevisionDetails({ record, source, showSource }: {
  record: QuoteHistoryRecord;
  source?: QuoteHistoryRecord;
  showSource: () => void;
}) {
  const added = source ? scopeDifference(record.items, source.items) : [];
  const removed = source ? scopeDifference(source.items, record.items) : [];
  const sameCurrency = source?.currency === record.currency;
  const difference = source
    ? (Math.round(record.total * 100) - Math.round(source.total * 100)) / 100
    : 0;

  return (
    <details className="mt-3 border-t border-border pt-2 text-sm lg:col-span-2">
      <summary className="font-medium text-accent">Ver cambios de la revisión</summary>
      <div className="mt-2 space-y-2 text-text-soft">
        <p className="wrap-anywhere">Versión de origen: {record.revisionOf}</p>
        {source ? (
          <>
            <button type="button" className="text-accent underline" onClick={showSource}>Ver cotización de origen</button>
            <p className="tabular-nums">
              Total anterior {formatCurrency(source.total, source.currency as Currency)} {source.currency}
              {" → "}
              {formatCurrency(record.total, record.currency as Currency)} {record.currency}
              {sameCurrency && (
                <> · {difference > 0 && "+"}{formatCurrency(difference, record.currency as Currency)}</>
              )}
            </p>
            {!sameCurrency && <p>Las versiones usan monedas distintas.</p>}
            {added.length === 0 && removed.length === 0
              ? <p>Las funcionalidades y las horas coinciden.</p>
              : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ScopeList label="Funcionalidades anteriores" items={removed} />
                  <ScopeList label="Funcionalidades nuevas o modificadas" items={added} />
                </div>
              )}
          </>
        ) : <p>La cotización de origen no está disponible en este historial.</p>}
      </div>
    </details>
  );
}

function ScopeList({ label, items }: { label: string; items: ScopeItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-medium text-text">{label}</p>
      <ul className="list-disc ps-5">
        {items.map(({ name, hours, complexity }, index) => (
          <li key={index} className="wrap-anywhere">{name} · {hours} h · {complexity}</li>
        ))}
      </ul>
    </div>
  );
}
