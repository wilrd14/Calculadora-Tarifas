import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export const inputClassName =
  "w-full min-w-0 rounded-md border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:ring-1 focus:ring-accent";

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, error, children, className }: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  const control = error && isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string }>, {
        "aria-invalid": true,
        "aria-describedby": errorId,
      })
    : children;

  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-text">
        {label}
      </label>
      {control}
      {error && <p id={errorId} className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-semibold text-text">{children}</h2>;
}
