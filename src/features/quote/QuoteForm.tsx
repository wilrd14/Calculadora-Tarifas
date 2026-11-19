import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  PROJECT_TYPES,
  defaultQuoteFormValues,
  quoteFormSchema,
  type QuoteFormInput,
  type QuoteFormValues,
} from "./schema";
import { COMPLEXITY_MULTIPLIERS } from "./complexityMultipliers";
import { PROJECT_ARCHETYPES } from "./archetypes";
import {
  FormField,
  SectionHeading,
  inputClassName,
} from "../../components/FormField";
import { CURRENCIES, type Currency } from "../../lib/currency";
import { QuoteItemsField } from "../../components/QuoteItemsField";
import { QuoteTemplates } from "../templates/QuoteTemplates";
import type { QuoteTemplate } from "../templates/db";
import { AdditionalChargesField } from "../../components/AdditionalChargesField";
import { QuotePreview } from "../../components/QuotePreview";
import type { PreparedQuotePdf } from "../pdf/generateQuotePdf";
import { QuotePdfDialog } from "./QuotePdfDialog";
import type { Client } from "../clients/db";
import { exchangeRateFormat, type ExchangeRateSnapshot } from "../../lib/exchangeRate";

const rateRefreshIntervalMs = 15 * 60 * 1000;
let lastAutomaticRefresh = 0;

type PdfStatus =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "success"; path: string }
  | { kind: "error"; message: string };

interface QuoteFormProps {
  /** Valores iniciales al duplicar una cotización del historial. */
  initialValues?: QuoteFormInput;
  active: boolean;
  onDraftChange?: (values: QuoteFormInput) => void;
}

/**
 * Formulario de cotización: cliente/proyecto, ítems, tarifa, cargos
 * adicionales, descuento y condiciones, con vista previa del total en
 * tiempo real. Al enviarlo, genera el PDF, lo guarda en
 * `Documentos/Cotizaciones` y registra la cotización en el historial.
 */
export function QuoteForm({ initialValues, active, onDraftChange }: QuoteFormProps) {
  const id = useId();
  const defaultsLoaded = useRef(Boolean(initialValues));
  const draftDirty = useRef(false);
  const draftHasEdits = useRef(false);
  const conversionBase = useRef<{ amount: number; currency: Currency } | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<(typeof PROJECT_ARCHETYPES)[number] | null>(null);
  const form = useForm<QuoteFormInput, unknown, QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: initialValues ?? defaultQuoteFormValues,
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    setValue,
    subscribe,
    getValues,
    getFieldState,
    formState: { errors },
  } = form;

  // Única instancia de useFieldArray para "items" — se pasa a
  // QuoteItemsField por props para que "Tipo de proyecto" pueda
  // reemplazarlos (dos useFieldArray separados para el mismo campo no se
  // mantenían en sincronía de forma confiable).
  const {
    fields: itemFields,
    append: appendItem,
    remove: removeItem,
    replace: replaceItems,
  } = useFieldArray({ control: form.control, name: "items" });

  const charges = useFieldArray({ control: form.control, name: "additionalCharges" });

  function applySavedTemplate(values: QuoteTemplate["values"]) {
    setPendingTemplate(null);
    setValue("projectType", values.projectType, { shouldDirty: true, shouldValidate: true });
    replaceItems(values.items);
    charges.replace(values.additionalCharges);
    setValue("complexityMultiplierIds", values.complexityMultiplierIds, { shouldDirty: true });
    setValue("discountPercent", values.discountPercent, { shouldDirty: true, shouldValidate: true });
    setValue("paymentTerms", values.paymentTerms, { shouldDirty: true });
    setValue("estimatedDelivery", values.estimatedDelivery, { shouldDirty: true });
  }

  const [pdfStatus, setPdfStatus] = useState<PdfStatus>({ kind: "idle" });
  const previewBusy = useRef(false);
  const [preview, setPreview] = useState<{ document: PreparedQuotePdf; values: QuoteFormValues; url: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [clients, setClients] = useState<Client[]>([]);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRateSnapshot | null>(initialValues?.exchangeRate ?? null);
  const [rateOffer, setRateOffer] = useState<ExchangeRateSnapshot | null>(null);
  const [rateNotice, setRateNotice] = useState("");

  const draftCallback = useRef(onDraftChange);
  const draftRate = useRef(exchangeRate);

  useEffect(() => { draftCallback.current = onDraftChange; }, [onDraftChange]);
  useEffect(() => {
    draftRate.current = exchangeRate;
    if (draftHasEdits.current) {
      draftCallback.current?.({ ...getValues(), exchangeRate: exchangeRate ?? undefined });
    }
  }, [exchangeRate, getValues]);

  useEffect(() => {
    let subscribed = true;
    let scheduled = false;
    const unsubscribe = subscribe({
      formState: { isDirty: true, values: true },
      callback: ({ isDirty }) => {
        draftDirty.current = Boolean(isDirty);
        draftHasEdits.current ||= Boolean(isDirty);
        if (!draftHasEdits.current || scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (subscribed) {
            draftCallback.current?.({ ...getValues(), exchangeRate: draftRate.current ?? undefined });
          }
        });
      },
    });
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [getValues, subscribe]);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  // Clientes guardados, para el selector "Cliente guardado" de abajo.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    import("../clients/db")
      .then(({ listClients }) => listClients())
      .then((rows) => {
        if (!cancelled) setClients(rows);
      })
      .catch((error: unknown) => {
        console.error("Error cargando clientes:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [active, pdfStatus.kind]);

  function handleSelectClient(event: ChangeEvent<HTMLSelectElement>) {
    const client = clients.find((c) => c.id === event.target.value);
    if (client) {
      setValue("clientName", client.name, { shouldDirty: true });
      setValue("clientContact", client.contact, { shouldDirty: true });
    }
  }

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    function offerRate(rate: ExchangeRateSnapshot) {
      if (!cancelled) setRateOffer(rate);
    }

    async function loadSettings() {
      const { getSettings, getEffectiveExchangeRate, refreshExchangeRate } = await import("../settings/db");
      const settings = await getSettings();
      if (cancelled) return;
      const newDraft = !defaultsLoaded.current;
      if (newDraft) {
        defaultsLoaded.current = true;
        if (!getFieldState("hourlyRate").isDirty && !getFieldState("currency").isDirty) {
          setValue("hourlyRate", settings.hourlyRate);
          setValue("currency", settings.currency);
        }
      }

      const effectiveRate = getEffectiveExchangeRate(settings);
      setExchangeRate((current) => current ?? effectiveRate);
      offerRate(effectiveRate);
      setRateNotice("");
      if (settings.exchangeRateMode === "automatic" && Date.now() - lastAutomaticRefresh >= rateRefreshIntervalMs) {
        lastAutomaticRefresh = Date.now();
        try {
          const latest = await refreshExchangeRate(settings);
          if (cancelled) return;
          if (newDraft && !draftDirty.current) setExchangeRate(latest);
          offerRate(latest);
        } catch {
          if (!cancelled) setRateNotice("No se pudo actualizar la tasa. Puedes reintentar en Configuración.");
        }
      }
    }

    void loadSettings().catch((error: unknown) => {
      console.error("Error cargando configuración:", error);
      if (!cancelled) setRateNotice("No se pudo cargar la tasa configurada.");
    });
    return () => { cancelled = true; };
  }, [active, getFieldState, setValue]);

  function convertHourlyRate(currency: Currency, rate: number) {
    const base = conversionBase.current;
    if (!base) return;
    const converted = currency === base.currency
      ? base.amount
      : currency === "USD" ? base.amount / rate : base.amount * rate;
    setValue("hourlyRate", Math.round(converted * 100) / 100, { shouldDirty: true, shouldValidate: true });
  }

  function handleCurrencyChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!exchangeRate) return;
    const currency = event.target.value as Currency;
    const amount = Number(getValues("hourlyRate"));
    if (!Number.isFinite(amount)) return;
    conversionBase.current ??= { amount, currency: currency === "USD" ? "DOP" : "USD" };
    convertHourlyRate(currency, exchangeRate.rate);
  }

  function applyRate(rate: ExchangeRateSnapshot) {
    setExchangeRate(rate);
    convertHourlyRate(getValues("currency"), rate.rate);
  }

  function handleProjectTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    const archetype = PROJECT_ARCHETYPES.find((entry) => entry.projectType === event.target.value);
    if (!archetype) {
      setPendingTemplate(null);
      return;
    }

    const items = getValues("items");
    const hasExistingScope = items.length !== 1 || items.some((item) =>
      item.name.trim() || item.complexity !== "Personalizado" || Number(item.hours) !== 1
    );
    if (hasExistingScope) {
      setPendingTemplate(archetype);
    } else {
      replaceItems(archetype.items);
      setPendingTemplate(null);
    }
  }

  const newRate = rateOffer && (
    rateOffer.rate !== exchangeRate?.rate ||
    rateOffer.source !== exchangeRate?.source ||
    rateOffer.side !== exchangeRate?.side ||
    rateOffer.effectiveDate !== exchangeRate?.effectiveDate
  ) ? rateOffer : null;

  async function preparePreview(values: QuoteFormValues) {
    if (previewBusy.current) return;
    previewBusy.current = true;
    setPdfStatus({ kind: "preparing" });
    try {
      const { prepareQuotePdf } = await import("../pdf/generateQuotePdf");
      const quote = { ...values, exchangeRate: exchangeRate ?? undefined };
      const document = await prepareQuotePdf(quote);
      setPreview({ document, values: quote, url: URL.createObjectURL(document.blob) });
      setExportError(undefined);
      setPdfStatus({ kind: "idle" });
    } catch (error) {
      console.error("Error preparando el PDF:", error);
      setPdfStatus({ kind: "error", message: "No se pudo preparar la vista previa. Intenta de nuevo." });
    } finally {
      previewBusy.current = false;
    }
  }

  async function exportPreview() {
    if (!preview || previewBusy.current) return;
    previewBusy.current = true;
    setExporting(true);
    setExportError(undefined);
    try {
      const [{ generateAndSaveQuotePdf }, { saveQuoteToHistory }] = await Promise.all([
        import("../pdf/generateQuotePdf"),
        import("../history/db"),
      ]);
      const { path, quoteNumber, total } = await generateAndSaveQuotePdf(preview.values, preview.document);
      try {
        await saveQuoteToHistory({
          id: quoteNumber,
          quote: preview.values,
          total,
          pdfPath: path,
          createdAt: preview.document.date,
        });
      } catch (error) {
        console.error("Error guardando la cotización en el historial:", error);
        setExportError("El PDF se guardó en Documentos/Cotizaciones. Vuelve a intentar para registrarlo en el historial.");
        return;
      }

      try {
        const { upsertClientByName } = await import("../clients/db");
        await upsertClientByName(preview.values.clientName, preview.values.clientContact);
      } catch (error) {
        console.error("Error guardando cliente:", error);
      }
      setPreview(null);
      setPdfStatus({ kind: "success", path });
    } catch (error) {
      console.error("Error guardando el PDF:", error);
      setExportError("No se pudo guardar el PDF en Documentos/Cotizaciones. Intenta de nuevo.");
    } finally {
      previewBusy.current = false;
      setExporting(false);
    }
  }

  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={handleSubmit(preparePreview, () => setPdfStatus({
          kind: "error",
          message: "Revisa los campos marcados para preparar el PDF.",
        }))}
        className="quote-layout"
      >
        <div className="quote-editor">
          <section className="quote-group">
            <SectionHeading>Cliente y proyecto</SectionHeading>
            {initialValues?.revisionOf && (
              <p className="text-sm text-text-soft wrap-anywhere">Revisión de {initialValues.revisionOf}</p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {clients.length > 0 && (
                <FormField
                  label="Cliente guardado"
                  htmlFor={`${id}-savedClient`}
                  className="sm:col-span-2"
                >
                  <select
                    id={`${id}-savedClient`}
                    className={inputClassName}
                    defaultValue=""
                    onChange={handleSelectClient}
                  >
                    <option value="">
                      Selecciona un cliente
                    </option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              <FormField
                label="Cliente / Empresa"
                htmlFor={`${id}-clientName`}
                error={errors.clientName?.message}
              >
                <input
                  id={`${id}-clientName`}
                  className={inputClassName}
                  placeholder="Nombre del cliente o empresa"
                  {...register("clientName")}
                />
              </FormField>

              <FormField label="Contacto del cliente" htmlFor={`${id}-clientContact`}>
                <input
                  id={`${id}-clientContact`}
                  className={inputClassName}
                  placeholder="Email o teléfono (opcional)"
                  {...register("clientContact")}
                />
              </FormField>

              <FormField
                label="Nombre del proyecto"
                htmlFor={`${id}-projectName`}
                error={errors.projectName?.message}
              >
                <input
                  id={`${id}-projectName`}
                  className={inputClassName}
                  placeholder="Ej. App de inventario"
                  {...register("projectName")}
                />
              </FormField>

              <FormField
                label="Tipo de proyecto"
                htmlFor={`${id}-projectType`}
                error={errors.projectType?.message}
              >
                <select
                  id={`${id}-projectType`}
                  className={inputClassName}
                  {...register("projectType", {
                    onChange: handleProjectTypeChange,
                  })}
                >
                  <option value="" disabled>Selecciona un tipo</option>
                  {PROJECT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </FormField>
              {pendingTemplate && (
                <div className="rounded-md bg-surface-raised p-3 sm:col-span-2">
                  <p className="mb-2">La plantilla de {pendingTemplate.projectType} reemplazará las funcionalidades actuales.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="secondary-action" onClick={() => {
                      replaceItems(pendingTemplate.items);
                      setPendingTemplate(null);
                    }}>Aplicar plantilla</button>
                    <button type="button" className="secondary-action" onClick={() => setPendingTemplate(null)}>
                      Conservar funcionalidades
                    </button>
                  </div>
                </div>
              )}

              <FormField
                label="Descripción del alcance"
                htmlFor={`${id}-description`}
                className="sm:col-span-2"
              >
                <textarea
                  id={`${id}-description`}
                  rows={3}
                  className={inputClassName}
                  placeholder="Breve resumen del alcance del proyecto"
                  {...register("description")}
                />
              </FormField>
            </div>
          </section>

          <div className="quote-group">
            {active && <QuoteTemplates readQuote={getValues} applyTemplate={applySavedTemplate} />}
            <QuoteItemsField fields={itemFields} append={appendItem} remove={removeItem} />
          </div>

          <section className="quote-group">
            <SectionHeading>Precio y ajustes</SectionHeading>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                label="Tarifa por hora"
                htmlFor={`${id}-hourlyRate`}
                error={errors.hourlyRate?.message}
              >
                <input
                  id={`${id}-hourlyRate`}
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputClassName}
                  {...register("hourlyRate", { onChange: () => { conversionBase.current = null; } })}
                />
              </FormField>

              <FormField label="Moneda" htmlFor={`${id}-currency`}>
                <select
                  id={`${id}-currency`}
                  className={inputClassName}
                  aria-describedby={`${id}-rate`}
                  {...register("currency", { onChange: handleCurrencyChange })}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Descuento (%)"
                htmlFor={`${id}-discountPercent`}
                error={errors.discountPercent?.message}
              >
                <input
                  id={`${id}-discountPercent`}
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  className={inputClassName}
                  {...register("discountPercent")}
                />
              </FormField>
            </div>
            <div id={`${id}-rate`} className="rounded-md bg-well p-3 text-sm text-text-soft">
              {exchangeRate && (
                <p className="amount">
                  <strong className="font-medium text-text">1 USD = {exchangeRateFormat.format(exchangeRate.rate)} DOP</strong>
                  {" · "}{exchangeRate.source}
                  {exchangeRate.side && (exchangeRate.side === "buy" ? " · Compra" : " · Venta")}
                  {exchangeRate.effectiveDate && ` · ${exchangeRate.effectiveDate}`}
                </p>
              )}
              {exchangeRate?.variationPercent != null && (
                <p className="amount">
                  {new Intl.NumberFormat("es-DO", { signDisplay: "exceptZero", maximumFractionDigits: 2 }).format(exchangeRate.variationPercent)}% respecto a la publicación anterior
                </p>
              )}
              {!exchangeRate && !rateNotice && <p role="status">Cargando tasa configurada…</p>}
              {rateNotice && <p role="status">{rateNotice}</p>}
              {newRate && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span>Tasa disponible: {exchangeRateFormat.format(newRate.rate)} DOP por USD.</span>
                  <button type="button" className="secondary-action" onClick={() => applyRate(newRate)}>Aplicar tasa</button>
                </div>
              )}
            </div>
            <h3 className="font-semibold">Recargos de complejidad</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {COMPLEXITY_MULTIPLIERS.map((multiplier) => (
                <label
                  key={multiplier.id}
                  className="flex items-center gap-2 rounded border border-border bg-well px-3 py-2 text-sm text-text-soft has-[:checked]:border-accent has-[:checked]:text-text"
                >
                  <input
                    type="checkbox"
                    value={multiplier.id}
                    className="accent-accent"
                    {...register("complexityMultiplierIds")}
                  />
                  {multiplier.label}
                  <span className="ml-auto amount text-sm font-medium">
                    +{multiplier.percent}%
                  </span>
                </label>
              ))}
            </div>
            <AdditionalChargesField fields={charges.fields} append={charges.append} remove={charges.remove} />
          </section>

          <section className="quote-group">
            <SectionHeading>Condiciones</SectionHeading>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Forma de pago" htmlFor={`${id}-paymentTerms`}>
                <input
                  id={`${id}-paymentTerms`}
                  className={inputClassName}
                  placeholder="Ej. 50% al iniciar, 50% contra entrega"
                  {...register("paymentTerms")}
                />
              </FormField>

              <FormField label="Tiempo estimado de entrega" htmlFor={`${id}-estimatedDelivery`}>
                <input
                  id={`${id}-estimatedDelivery`}
                  className={inputClassName}
                  placeholder="Ej. 3–4 semanas desde el inicio"
                  {...register("estimatedDelivery")}
                />
              </FormField>
            </div>
          </section>

        </div>
        <QuotePreview
          preparing={pdfStatus.kind === "preparing"}
          message={pdfStatus.kind === "error"
            ? { text: pdfStatus.message, error: true }
            : pdfStatus.kind === "success"
              ? { text: `PDF guardado: ${pdfStatus.path}`, error: false }
              : undefined}
        />
      </form>
      {active && preview && (
        <QuotePdfDialog
          url={preview.url}
          exporting={exporting}
          error={exportError}
          onClose={() => setPreview(null)}
          onExport={() => void exportPreview()}
        />
      )}
    </FormProvider>
  );
}
