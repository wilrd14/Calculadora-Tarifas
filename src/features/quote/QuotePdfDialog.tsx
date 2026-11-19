import { useEffect, useId, useRef } from "react";

interface QuotePdfDialogProps {
  url: string;
  exporting: boolean;
  error?: string;
  onClose: () => void;
  onExport: () => void;
}

export function QuotePdfDialog({ url, exporting, error, onClose, onExport }: QuotePdfDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-busy={exporting}
      className="pdf-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!exporting) onClose();
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <h2 id={titleId} className="text-base font-semibold">Vista previa de la cotización</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="secondary-action" disabled={exporting} onClick={onClose}>
            Volver a editar
          </button>
          <button type="button" className="primary-action" disabled={exporting} onClick={onExport}>
            {exporting ? "Guardando PDF…" : "Guardar PDF"}
          </button>
        </div>
      </header>
      {error && <p className="border-b border-border px-4 py-2 text-danger" role="alert">{error}</p>}
      <iframe className="pdf-dialog-document" title="Documento PDF de la cotización" src={url} />
    </dialog>
  );
}
