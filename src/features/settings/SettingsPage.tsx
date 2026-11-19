import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  FormField,
  SectionHeading,
  inputClassName,
} from "../../components/FormField";
import { CURRENCIES } from "../../lib/currency";
import {
  automaticRateSnapshot,
  exchangeRateFormat,
  type ExchangeRateCache,
} from "../../lib/exchangeRate";
import { getSettings, refreshExchangeRate, saveSettings } from "./db";
import {
  settingsFormSchema,
  type SettingsFormInput,
  type SettingsFormValues,
} from "./schema";

type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type RefreshStatus = "idle" | "refreshing" | "success" | { error: string };

const dateFormat = new Intl.DateTimeFormat("es-DO", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const variationFormat = new Intl.NumberFormat("es-DO", {
  style: "percent",
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

/**
 * Configuración (Fase 4): tarifa por hora y moneda por defecto para
 * cotizaciones nuevas, y los datos del freelancer que aparecen en el PDF.
 */
export function SettingsPage() {
  const form = useForm<SettingsFormInput, unknown, SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
  });
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;

  const [loadStatus, setLoadStatus] = useState<LoadStatus>({ kind: "loading" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [rateCache, setRateCache] = useState<ExchangeRateCache | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>("idle");
  const mode = useWatch({ control, name: "exchangeRateMode" });
  const side = useWatch({ control, name: "exchangeRateSide" }) ?? "buy";
  const automaticRate = automaticRateSnapshot(rateCache, side);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) return;
        reset(settings);
        setRateCache(settings.exchangeRateCache);
        setLoadStatus({ kind: "ready" });
      })
      .catch((error: unknown) => {
        console.error("Error cargando la configuración:", error);
        if (cancelled) return;
        setLoadStatus({
          kind: "error",
          message: "No se pudo cargar la configuración.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reset]);

  async function onSubmit(values: SettingsFormValues) {
    setSaveStatus({ kind: "saving" });
    try {
      await saveSettings(values);
      setSaveStatus({ kind: "saved" });
    } catch (error) {
      console.error("Error guardando la configuración:", error);
      setSaveStatus({
        kind: "error",
        message: "No se pudo guardar. Intenta de nuevo.",
      });
    }
  }

  async function handleRefresh() {
    setRefreshStatus("refreshing");
    try {
      await refreshExchangeRate({ exchangeRateSide: side });
      setRateCache((await getSettings()).exchangeRateCache);
      setRefreshStatus("success");
    } catch (error) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error ? error.message : "No se pudo consultar la tasa de cambio.";
      setRefreshStatus({ error: message });
    }
  }

  async function handleOpenDivisa() {
    try {
      await openUrl("https://divisa.do/developers/console");
    } catch {
      setRefreshStatus({ error: "Abre divisa.do/developers/console en el navegador." });
    }
  }

  if (loadStatus.kind === "loading") {
    return <p role="status" className="text-sm text-text-soft">Cargando configuración…</p>;
  }

  if (loadStatus.kind === "error") {
    return <p role="alert" className="text-sm text-danger">{loadStatus.message}</p>;
  }

  return (
    <form
      onChange={() => {
        if (saveStatus.kind === "saved" || saveStatus.kind === "error") {
          setSaveStatus({ kind: "idle" });
        }
      }}
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-5xl space-y-7"
    >
      <section className="grid items-start gap-3 lg:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] lg:gap-6">
        <div className="space-y-1">
          <SectionHeading>Tarifa y moneda</SectionHeading>
          <p className="text-sm text-text-soft">Valores predeterminados para nuevas cotizaciones.</p>
        </div>
        <div className="grid gap-4 rounded-lg border border-border bg-well p-4 sm:grid-cols-2">
          <FormField
            label="Tarifa por hora por defecto"
            htmlFor="hourlyRate"
            error={errors.hourlyRate?.message}
          >
            <input
              id="hourlyRate"
              type="number"
              step="0.01"
              min="0"
              className={inputClassName}
              {...register("hourlyRate")}
            />
          </FormField>

          <FormField label="Moneda por defecto" htmlFor="currency">
            <select
              id="currency"
              className={inputClassName}
              {...register("currency")}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Modo de tasa de cambio" htmlFor="exchangeRateMode">
            <select id="exchangeRateMode" className={inputClassName} {...register("exchangeRateMode")}>
              <option value="manual">Manual</option>
              <option value="automatic">Automática</option>
            </select>
          </FormField>
          <FormField
            label={mode === "automatic" ? "Tasa manual de respaldo · DOP por USD" : "Tasa de cambio · DOP por USD"}
            htmlFor="exchangeRateDopPerUsd"
            error={errors.exchangeRateDopPerUsd?.message}
          >
            <input
              id="exchangeRateDopPerUsd"
              type="number"
              step="any"
              min="0.01"
              className={`${inputClassName} tabular-nums`}
              {...register("exchangeRateDopPerUsd")}
            />
          </FormField>

          {mode === "automatic" && (
            <>
              <FormField label="Tasa de referencia del Banco Central" htmlFor="exchangeRateSide">
                <select
                  id="exchangeRateSide"
                  className={inputClassName}
                  {...register("exchangeRateSide")}
                >
                  <option value="buy">Compra</option>
                  <option value="sell">Venta</option>
                </select>
              </FormField>
              <div className="space-y-2 border-t border-border pt-3 sm:col-span-2">
                {automaticRate ? (
                  <div className="space-y-0.5">
                    <p className="text-lg font-semibold text-text tabular-nums">
                      {exchangeRateFormat.format(automaticRate.rate)} DOP por USD
                    </p>
                    <p className="text-sm text-text-soft">
                      {automaticRate.source} · {dateFormat.format(new Date(`${automaticRate.effectiveDate}T00:00:00Z`))}
                    </p>
                    {automaticRate.variationPercent !== null && (
                      <p className="text-sm text-text-soft tabular-nums">
                        {variationFormat.format(automaticRate.variationPercent / 100)} frente a la publicación anterior
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-text-soft">
                    Se usa la tasa manual hasta guardar la primera referencia automática.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    disabled={refreshStatus === "refreshing"}
                    onClick={handleRefresh}
                    className="rounded-md border border-control bg-surface px-3 py-2 text-sm font-medium text-text hover:bg-well disabled:opacity-60"
                  >
                    {refreshStatus === "refreshing" ? "Consultando…" : "Actualizar tasa"}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenDivisa}
                    className="py-2 text-sm text-accent underline underline-offset-2"
                  >
                    Mi consola de Divisa.do
                  </button>
                </div>
                <p className="text-xs text-text-soft">
                  Si Divisa.do solicita una clave, crea una en tu consola, guárdala como variable de usuario
                  de Windows <code>DIVISA_API_KEY</code> y reinicia la app.
                </p>
                <div role="status" aria-live="polite">
                  {refreshStatus === "success" && <p className="text-sm text-success">Consulta completada.</p>}
                  {typeof refreshStatus === "object" && (
                    <p className="text-sm text-danger">{refreshStatus.error}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="grid items-start gap-3 border-t border-border pt-7 lg:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] lg:gap-6">
        <div className="space-y-1">
          <SectionHeading>Datos del freelancer</SectionHeading>
          <p className="text-sm text-text-soft">Se muestran en el PDF de la cotización.</p>
        </div>

        <div className="grid gap-4 rounded-lg border border-border bg-well p-4 sm:grid-cols-2">
          <FormField
            label="Nombre completo"
            htmlFor="freelancerName"
            error={errors.freelancerName?.message}
            className="sm:col-span-2"
          >
            <input
              id="freelancerName"
              className={inputClassName}
              {...register("freelancerName")}
            />
          </FormField>

          <FormField
            label="Descripción profesional"
            htmlFor="freelancerTagline"
            className="sm:col-span-2"
          >
            <input
              id="freelancerTagline"
              className={inputClassName}
              placeholder="Ej. Desarrollo web a medida"
              {...register("freelancerTagline")}
            />
          </FormField>

          <FormField label="Email" htmlFor="freelancerEmail">
            <input
              id="freelancerEmail"
              type="email"
              className={inputClassName}
              {...register("freelancerEmail")}
            />
          </FormField>

          <FormField label="Teléfono" htmlFor="freelancerPhone">
            <input
              id="freelancerPhone"
              className={inputClassName}
              {...register("freelancerPhone")}
            />
          </FormField>

          <FormField
            label="Portafolio / sitio web"
            htmlFor="freelancerPortfolio"
          >
            <input
              id="freelancerPortfolio"
              className={inputClassName}
              {...register("freelancerPortfolio")}
            />
          </FormField>

          <FormField
            label="Usuario en el pie del PDF"
            htmlFor="freelancerHandle"
          >
            <input
              id="freelancerHandle"
              className={inputClassName}
              placeholder="Ej. tuusuario"
              {...register("freelancerHandle")}
            />
          </FormField>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-4 border-t border-border pt-5">
        <button
          type="submit"
          disabled={saveStatus.kind === "saving"}
          className="rounded-md bg-text px-5 py-2.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-60"
        >
          {saveStatus.kind === "saving" ? "Guardando…" : "Guardar configuración"}
        </button>

        <div role="status" aria-live="polite">
          {saveStatus.kind === "saved" && (
            <p className="text-sm text-success">Configuración guardada.</p>
          )}
          {saveStatus.kind === "error" && (
            <p className="text-sm text-danger">{saveStatus.message}</p>
          )}
        </div>
      </div>
    </form>
  );
}
