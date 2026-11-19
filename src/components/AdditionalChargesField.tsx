import { useId } from "react";
import { useFormContext, type UseFieldArrayReturn } from "react-hook-form";
import {
  emptyAdditionalCharge,
  type QuoteFormInput,
} from "../features/quote/schema";
import { FormField, SectionHeading, inputClassName } from "./FormField";

/** Lista dinámica de cargos adicionales opcionales (diseño UI, despliegue, urgencia, etc.). */
type ChargeFields = Pick<UseFieldArrayReturn<QuoteFormInput, "additionalCharges">, "fields" | "append" | "remove">;

export function AdditionalChargesField({ fields, append, remove }: ChargeFields) {
  const id = useId();
  const {
    register,
    formState: { errors },
  } = useFormContext<QuoteFormInput>();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeading>Cargos adicionales</SectionHeading>
        <button
          type="button"
          onClick={() => append(emptyAdditionalCharge)}
          className="secondary-action"
        >
          + Agregar cargo
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-text-faint">Sin cargos adicionales.</p>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="quote-charge-row"
          >
            <FormField
              label="Concepto"
              htmlFor={`${id}-additionalCharges.${index}.name`}
              error={errors.additionalCharges?.[index]?.name?.message}
            >
              <input
                id={`${id}-additionalCharges.${index}.name`}
                className={inputClassName}
                placeholder="Ej. Diseño UI"
                {...register(`additionalCharges.${index}.name`)}
              />
            </FormField>

            <FormField
              label="Monto"
              htmlFor={`${id}-additionalCharges.${index}.amount`}
              error={errors.additionalCharges?.[index]?.amount?.message}
            >
              <input
                id={`${id}-additionalCharges.${index}.amount`}
                type="number"
                step="0.01"
                min="0"
                className={inputClassName}
                {...register(`additionalCharges.${index}.amount`)}
              />
            </FormField>

            <button
              type="button"
              onClick={() => remove(index)}
              className="text-sm text-danger hover:opacity-75 row-remove"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
