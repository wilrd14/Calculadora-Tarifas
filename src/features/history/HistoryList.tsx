import { useEffect, useState } from "react";
import { exists } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { RevisionDetails } from "./RevisionDetails";
import { FormField, inputClassName } from "../../components/FormField";
import { formatCurrency, type Currency } from "../../lib/currency";
import type { QuoteFormValues } from "../quote/schema";
import {
  QUOTE_STATUSES,
  historyRecordToFormValues,
  listQuoteHistory,
  updateQuoteStatus,
  type QuoteHistoryRecord,
  type QuoteStatus,
} from "./db";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

interface HistoryListProps {
  /** Crea un borrador independiente o una revisión vinculada. */
  onCreateDraft: (values: QuoteFormValues) => void;
}

function searchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-DO");
}

const actionClassName =
  "rounded-md border border-border px-3 py-2 text-sm font-medium text-text hover:bg-surface-raised disabled:opacity-60";

/** Listado del historial de cotizaciones: estado editable y duplicar como plantilla. */
export function HistoryList({ onCreateDraft }: HistoryListProps) {
  const [records, setRecords] = useState<QuoteHistoryRecord[]>([]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pendingStatuses, setPendingStatuses] = useState<Record<string, boolean>>({});
  const [opening, setOpening] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const query = searchText(search.trim());
  const filteredRecords = records.filter(
    (record) =>
      (!statusFilter || record.status === statusFilter) &&
      searchText(`${record.projectName} ${record.clientName} ${record.id}`).includes(query),
  );

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    listQuoteHistory()
      .then((rows) => {
        if (cancelled) return;
        setRecords(rows);
        setState({ kind: "ready" });
      })
      .catch((error: unknown) => {
        console.error("Error cargando el historial:", error);
        if (cancelled) return;
        setState({
          kind: "error",
          message: "No se pudo cargar el historial de cotizaciones.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  async function handleStatusChange(id: string, status: QuoteStatus) {
    setPendingStatuses((current) => ({ ...current, [id]: true }));
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      await updateQuoteStatus(id, status);
      setRecords((prev) =>
        prev.map((record) => (record.id === id ? { ...record, status } : record)),
      );
    } catch (error) {
      console.error("Error actualizando el estado:", error);
      setErrors((current) => ({
        ...current,
        [id]: "No se pudo actualizar el estado. Intenta de nuevo.",
      }));
    } finally {
      setPendingStatuses((current) => ({ ...current, [id]: false }));
    }
  }

  async function handleOpenPdf(record: QuoteHistoryRecord) {
    const { id, pdfPath } = record;
    setOpening((current) => ({ ...current, [id]: true }));
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      if (!pdfPath || !(await exists(pdfPath))) {
        setErrors((current) => ({
          ...current,
          [id]: "No se encontró el PDF. Si lo moviste, devuélvelo a Documentos/Cotizaciones.",
        }));
        return;
      }
      await openPath(pdfPath);
    } catch (error) {
      console.error("Error abriendo el PDF:", error);
      setErrors((current) => ({
        ...current,
        [id]: "No se pudo abrir el PDF. Comprueba el acceso al archivo y que tengas un lector de PDF.",
      }));
    } finally {
      setOpening((current) => ({ ...current, [id]: false }));
    }
  }

  if (state.kind === "loading") {
    return <p role="status" className="text-sm text-text-soft">Cargando historial…</p>;
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p role="alert" className="text-sm text-danger">{state.message}</p>
        <button type="button" className={actionClassName} onClick={() => setLoadAttempt((value) => value + 1)}>
          Reintentar
        </button>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-border p-5">
        <h2 className="font-semibold">Aún no hay cotizaciones</h2>
        <p className="mt-1 text-sm text-text-soft">
          Genera un PDF desde Nueva cotización para guardarlo en el historial.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="Cotizaciones guardadas">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <FormField label="Buscar por cliente, proyecto o número" htmlFor="quote-history-search">
          <input
            id="quote-history-search"
            type="search"
            className={inputClassName}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </FormField>
        <FormField label="Estado" htmlFor="quote-history-filter">
          <select
            id="quote-history-filter"
            className={inputClassName}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">Todos</option>
            {QUOTE_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
        </FormField>
      </div>
      <p role="status" className="text-sm text-text-soft">
        {filteredRecords.length === 1 ? "1 cotización" : `${filteredRecords.length} cotizaciones`}
      </p>
      {filteredRecords.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-text-soft">Ninguna cotización coincide con los filtros.</p>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-accent underline"
            onClick={() => {
              setSearch("");
              setStatusFilter("");
            }}
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {filteredRecords.map((record) => (
            <li key={record.id} className="px-4 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-6">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-[1_1_12rem]">
                  <h2 className="break-words text-sm font-semibold">{record.projectName}</h2>
                  <p className="mt-1 break-words text-sm text-text-soft">
                    {record.clientName} ·{" "}
                    <time dateTime={record.createdAt}>
                      {new Date(record.createdAt).toLocaleDateString("es-DO")}
                    </time>
                  </p>
                  <p className="mt-1 wrap-anywhere text-xs text-text-faint">{record.id}</p>
                </div>
                <p className="max-w-full break-words text-right text-sm font-semibold tabular-nums">
                  {formatCurrency(record.total, record.currency as Currency)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 lg:mt-0">
                <select
                  aria-label={`Estado de ${record.projectName}`}
                  value={record.status}
                  disabled={pendingStatuses[record.id] || opening[record.id]}
                  onChange={(event) =>
                    handleStatusChange(
                      record.id,
                      event.target.value as QuoteStatus,
                    )
                  }
                  className="mr-auto rounded-md border border-border bg-well px-3 py-2 text-sm disabled:opacity-60"
                >
                  {QUOTE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Abrir PDF de ${record.projectName}`}
                  onClick={() => handleOpenPdf(record)}
                  disabled={opening[record.id] || pendingStatuses[record.id]}
                  className={actionClassName}
                >
                  {opening[record.id] ? "Abriendo…" : "Abrir PDF"}
                </button>
                <button
                  type="button"
                  aria-label={`Crear revisión de ${record.projectName}`}
                  onClick={() => onCreateDraft({ ...historyRecordToFormValues(record), revisionOf: record.id })}
                  className={actionClassName}
                >
                  Crear revisión
                </button>
                <button
                  type="button"
                  aria-label={`Duplicar cotización de ${record.projectName}`}
                  onClick={() => onCreateDraft(historyRecordToFormValues(record))}
                  className={actionClassName}
                >
                  Duplicar
                </button>
              </div>
              {record.revisionOf && (
                <RevisionDetails
                  record={record}
                  source={recordsById.get(record.revisionOf)}
                  showSource={() => {
                    setSearch(record.revisionOf ?? "");
                    setStatusFilter("");
                  }}
                />
              )}
              {errors[record.id] && (
                <p role="alert" className="mt-2 text-sm text-danger lg:col-span-2">
                  {errors[record.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
