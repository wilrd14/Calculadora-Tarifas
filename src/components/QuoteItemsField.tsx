import { useId } from "react";
import type { ChangeEvent } from "react";
import type { FieldArrayWithId } from "react-hook-form";
import { useFormContext } from "react-hook-form";
import {
  COMPLEXITY_HOURS,
  COMPLEXITY_LEVELS,
  emptyQuoteItem,
  type QuoteFormInput,
} from "../features/quote/schema";
import { FormField, SectionHeading, inputClassName } from "./FormField";

interface QuoteItemsFieldProps {
  /**
   * `fields`/`append`/`remove` vienen de un único `useFieldArray` que vive
   * en `QuoteForm.tsx` (no aquí) — así "Tipo de proyecto" puede reemplazar
   * la lista con `replace()` sobre la misma instancia que renderiza estas
   * filas. Tener dos `useFieldArray` distintos para "items" no se
   * mantenía en sincronía de forma confiable.
   */
  fields: FieldArrayWithId<QuoteFormInput, "items", "id">[];
  append: (item: QuoteFormInput["items"][number]) => void;
  remove: (index: number) => void;
}

/** Lista dinámica de funcionalidades/módulos de la cotización, con horas por complejidad. */
export function QuoteItemsField({ fields, append, remove }: QuoteItemsFieldProps) {
  const id = useId();
  const {
    register,
    setValue,
    formState: { errors },
  } = useFormContext<QuoteFormInput>();

  const arrayError =
    typeof errors.items?.message === "string" ? errors.items.message : undefined;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeading>Alcance y horas</SectionHeading>
        <button
          type="button"
          onClick={() => append(emptyQuoteItem)}
          className="secondary-action"
        >
          + Agregar funcionalidad
        </button>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => {
          function handleComplexityChange(event: ChangeEvent<HTMLSelectElement>) {
            const level = event.target.value;
            if (level === "Baja" || level === "Media" || level === "Alta") {
              setValue(`items.${index}.hours`, COMPLEXITY_HOURS[level]);
            }
          }

          return (
            <div
              key={field.id}
              className="quote-item-row"
            >
              <FormField
                label="Nombre"
                htmlFor={`${id}-items.${index}.name`}
                error={errors.items?.[index]?.name?.message}
              >
                <input
                  id={`${id}-items.${index}.name`}
                  className={inputClassName}
                  placeholder="Ej. Login de usuarios"
                  {...register(`items.${index}.name`)}
                />
              </FormField>

              <FormField label="Complejidad" htmlFor={`${id}-items.${index}.complexity`}>
                <select
                  id={`${id}-items.${index}.complexity`}
                  className={inputClassName}
                  {...register(`items.${index}.complexity`, {
                    onChange: handleComplexityChange,
                  })}
                >
                  {COMPLEXITY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Horas"
                htmlFor={`${id}-items.${index}.hours`}
                error={errors.items?.[index]?.hours?.message}
              >
                <input
                  id={`${id}-items.${index}.hours`}
                  type="number"
                  step="0.25"
                  min="0"
                  className={inputClassName}
                  {...register(`items.${index}.hours`)}
                />
              </FormField>

              <button
                type="button"
                onClick={() => remove(index)}
                disabled={fields.length === 1}
                className="text-sm text-danger hover:opacity-75 disabled:cursor-not-allowed disabled:text-text-faint row-remove"
              >
                Quitar
              </button>
            </div>
          );
        })}
      </div>

      {arrayError && <p className="text-sm text-danger">{arrayError}</p>}
    </section>
  );
}
