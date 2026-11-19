import { useEffect, useId, useState } from "react";
import { FormField, inputClassName, SectionHeading } from "../../components/FormField";
import { useFormContext, useWatch } from "react-hook-form";
import type { QuoteFormInput } from "../quote/schema";
import { listTemplates, removeTemplate, saveTemplate, templateNameSchema, templateSchema, type QuoteTemplate } from "./db";

interface QuoteTemplatesProps {
  readQuote: () => QuoteFormInput;
  applyTemplate: (values: QuoteTemplate["values"]) => void;
}

export function QuoteTemplates({ readQuote, applyTemplate }: QuoteTemplatesProps) {
  const { control } = useFormContext<QuoteFormInput>();
  const currency = useWatch({ control, name: "currency" });
  const id = useId();
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [selection, setSelection] = useState("");
  const [name, setName] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "delete" | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const selected = templates.find((entry) => entry.id === selection);
  const currencyMismatch = selected && selected.values.additionalCharges.length > 0 && selected.values.currency !== currency;

  useEffect(() => {
    let active = true;
    listTemplates()
      .then((rows) => {
        if (active) {
          setTemplates(rows);
          setLoadFailed(false);
        }
      })
      .catch(() => { if (active) setLoadFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  async function save() {
    const parsedName = templateNameSchema.safeParse(name);
    if (!parsedName.success) {
      setNotice({ text: "Escribe un nombre para la plantilla (hasta 80 caracteres).", error: true });
      return;
    }
    const values = templateSchema.safeParse(readQuote());
    if (!values.success) {
      setNotice({ text: "Selecciona el tipo de proyecto y completa las funcionalidades y los cargos antes de guardar la plantilla.", error: true });
      return;
    }
    setBusy(true);
    try {
      const template = await saveTemplate(parsedName.data, values.data);
      setTemplates((rows) => [...rows, template].sort((a, b) => a.name.localeCompare(b.name, "es-DO")));
      setSelection(template.id);
      setName("");
      setConfirm(null);
      setNotice({ text: "Plantilla guardada." });
    } catch (error) {
      setNotice({
        text: String(error).includes("UNIQUE constraint failed")
          ? "Ya existe una plantilla con ese nombre."
          : "No se pudo guardar la plantilla. Intenta de nuevo.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    try {
      await removeTemplate(selected.id);
      setTemplates((rows) => rows.filter(({ id }) => id !== selected.id));
      setSelection("");
      setConfirm(null);
      setNotice({ text: "Plantilla eliminada." });
    } catch {
      setNotice({ text: "No se pudo eliminar la plantilla. Intenta de nuevo.", error: true });
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!selected || currencyMismatch) return;
    applyTemplate(selected.values);
    setConfirm(null);
    setNotice({ text: "Plantilla aplicada al borrador." });
  }

  return (
    <section className="space-y-3">
      <SectionHeading>Plantillas propias</SectionHeading>
      {loading ? <p role="status" className="text-sm text-text-soft">Cargando plantillas…</p> : loadFailed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-danger">No se pudieron cargar las plantillas.</p>
          <button type="button" className="secondary-action" onClick={() => {
            setLoading(true);
            setAttempt((current) => current + 1);
          }}>Reintentar</button>
        </div>
      ) : (
        <>
          {templates.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <FormField label="Plantilla guardada" htmlFor={id} className="min-w-0 grow">
                <select id={id} value={selection} disabled={busy} className={inputClassName}
                  onChange={(event) => {
                    setSelection(event.target.value);
                    setConfirm(null);
                    setNotice(undefined);
                  }}>
                  <option value="">Selecciona una plantilla</option>
                  {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </FormField>
              <button type="button" className="secondary-action" disabled={!selected || busy || Boolean(currencyMismatch)} onClick={() => setConfirm("apply")}>Aplicar plantilla</button>
              <button type="button" className="secondary-action" disabled={!selected || busy} onClick={() => setConfirm("delete")}>Eliminar plantilla</button>
            </div>
          )}
          {currencyMismatch && (
            <p className="text-sm text-text-soft">Cambia la moneda de la cotización a {selected.values.currency} para aplicar los cargos fijos de esta plantilla.</p>
          )}
          {confirm && selected && (
            <div className="space-y-2 rounded-md bg-well p-3">
              <p>{confirm === "apply"
                ? `Aplicar «${selected.name}» reemplazará el tipo de proyecto, las funcionalidades, los cargos, los recargos, el descuento y las condiciones de este borrador.`
                : `¿Eliminar «${selected.name}» de las plantillas guardadas?`}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="primary-action" disabled={busy || (confirm === "apply" && Boolean(currencyMismatch))}
                  onClick={confirm === "apply" ? apply : () => void remove()}>Confirmar</button>
                <button type="button" className="secondary-action" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button>
              </div>
            </div>
          )}
          <details>
            <summary className="font-medium">Guardar este borrador como plantilla</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <FormField label="Nombre de la plantilla" htmlFor={`${id}-name`} className="min-w-0 grow">
                <input id={`${id}-name`} className={inputClassName} value={name} maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (!busy) void save();
                    }
                  }} />
              </FormField>
              <button type="button" className="secondary-action" disabled={busy} onClick={() => void save()}>Guardar plantilla</button>
            </div>
          </details>
        </>
      )}
      {notice && <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-danger" : "text-success"}>{notice.text}</p>}
    </section>
  );
}
